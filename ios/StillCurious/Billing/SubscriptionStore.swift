import Combine
import Foundation
import StoreKit

/// Sent over the signed-in app's authenticated connection to its backend.
/// The backend must verify Apple's signature, environment, product, bundle,
/// account binding, expiration, refund/revocation state and episode allowance.
struct SubscriptionVerificationRequest: Codable, Sendable {
    let signedTransaction: String
    let transactionID: String
    let originalTransactionID: String
    let productID: String
    let appAccountToken: UUID
}

/// A backend response, not a flag inferred from the local purchase result.
/// Creation endpoints must independently enforce this entitlement and quota.
struct SubscriptionEntitlement: Codable, Sendable {
    let active: Bool
    let expiresAt: Date?
    let remainingEpisodes: Int?

    func isActive(at date: Date = .now) -> Bool {
        active && expiresAt.map { $0 > date } == true
    }
}

@MainActor
final class SubscriptionStore: ObservableObject {
    typealias ActivationHandler = @Sendable (SubscriptionVerificationRequest) async throws -> SubscriptionEntitlement

    @Published private(set) var product: Product?
    @Published private(set) var entitlement: SubscriptionEntitlement?
    @Published private(set) var isLoading = false
    @Published private(set) var isBusy = false
    @Published private(set) var message: String?
    @Published private(set) var planSummary: String?
    @Published private(set) var isConfigured = false

    let productID: String
    private var accountToken: UUID?
    private var activate: ActivationHandler?
    private var accountGeneration = UUID()
    private var updatesTask: Task<Void, Never>?
    private var processing = Set<UInt64>()

    init(productID: String) {
        self.productID = productID.trimmingCharacters(in: .whitespacesAndNewlines)
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                await self?.receive(result)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    var canPurchase: Bool {
        product?.type == .autoRenewable && isConfigured && !isBusy && !isLoading
    }

    /// Call only after the server has authenticated the user and returned their
    /// stable appAccountToken and exact plan benefits. Never generate this UUID
    /// locally, and never configure an activation handler that trusts the client.
    func configureAccount(
        accountToken: UUID,
        planSummary: String,
        activate: @escaping ActivationHandler
    ) {
        clearAccount()
        let summary = planSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !summary.isEmpty, !productID.isEmpty else { return }
        self.accountToken = accountToken
        self.planSummary = summary
        self.activate = activate
        isConfigured = true
        Task { await recoverTransactions() }
    }

    /// Use on sign-out or account change, including while purchase verification
    /// is running, to prevent a reply for the old account reaching the new one.
    func clearAccount() {
        accountGeneration = UUID()
        accountToken = nil
        activate = nil
        entitlement = nil
        planSummary = nil
        isConfigured = false
        message = nil
    }

    func loadProducts() async {
        guard !isLoading, product == nil else { return }
        guard !productID.isEmpty else {
            message = "Subscriptions are not available in this build yet. You can still listen to the free library."
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let products = try await Product.products(for: [productID])
            guard let selected = products.first(where: { $0.id == productID && $0.type == .autoRenewable }) else {
                message = "This subscription is currently unavailable. Please try again later."
                return
            }
            product = selected
        } catch {
            message = "The subscription could not be loaded. Check your connection and try again."
        }
    }

    func purchase() async {
        guard canPurchase, let product, let token = accountToken else {
            message = "Subscriptions are not available for this account yet."
            return
        }
        let generation = accountGeneration
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            let result = try await product.purchase(options: [.appAccountToken(token)])
            guard generation == accountGeneration else { return }
            switch result {
            case .success(let verification):
                await receive(verification)
            case .pending:
                message = "Your purchase is waiting for approval. Membership will update after Apple confirms it."
            case .userCancelled:
                message = "Purchase cancelled."
            @unknown default:
                message = "The purchase could not be completed. Please try again."
            }
        } catch {
            guard generation == accountGeneration else { return }
            message = "The purchase could not be completed. Please try again."
        }
    }

    func restorePurchases() async {
        guard isConfigured, !isBusy else {
            message = "Sign in to your Still Curious account before restoring purchases."
            return
        }
        let generation = accountGeneration
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            try await AppStore.sync()
            guard generation == accountGeneration else { return }
            let recovered = await recoverTransactions()
            guard generation == accountGeneration else { return }
            if !recovered && message == nil && processing.isEmpty {
                entitlement = nil
                message = "No active subscription was found for this Apple account."
            }
        } catch {
            guard generation == accountGeneration else { return }
            message = "Purchases could not be restored. Check your connection and try again."
        }
    }

    /// Run after sign-in and on foregrounding. Unfinished purchases survive app
    /// restarts and are retried; they are never discarded on a network failure.
    @discardableResult
    func recoverTransactions() async -> Bool {
        guard isConfigured else { return false }
        let generation = accountGeneration
        var found = false
        var seen = Set<UInt64>()
        for await result in Transaction.unfinished {
            guard generation == accountGeneration else { return found }
            if case .verified(let transaction) = result, transaction.productID == productID {
                seen.insert(transaction.id)
                found = await receive(result) || found
            }
        }
        for await result in Transaction.currentEntitlements {
            guard generation == accountGeneration else { return found }
            if case .verified(let transaction) = result,
               transaction.productID == productID,
               !seen.contains(transaction.id) {
                found = await receive(result) || found
            }
        }
        return found
    }

    @discardableResult
    private func receive(_ result: VerificationResult<Transaction>) async -> Bool {
        guard case .verified(let transaction) = result else {
            message = "Apple's purchase verification did not succeed. Your membership has not been changed."
            return false
        }
        guard transaction.productID == productID else { return false }
        guard let token = accountToken, let activate, isConfigured else {
            // Leave it unfinished for replay once its account is signed in.
            return false
        }
        guard transaction.appAccountToken == token else {
            message = "This purchase belongs to a different Still Curious account. Sign in to that account to restore it."
            return false
        }
        guard !processing.contains(transaction.id) else { return false }
        processing.insert(transaction.id)
        defer { processing.remove(transaction.id) }
        let generation = accountGeneration
        do {
            let verified = try await activate(SubscriptionVerificationRequest(
                signedTransaction: result.jwsRepresentation,
                transactionID: String(transaction.id),
                originalTransactionID: String(transaction.originalID),
                productID: transaction.productID,
                appAccountToken: token
            ))
            guard generation == accountGeneration else { return false }
            entitlement = verified
            // The server has persisted the verified purchase/revocation and its
            // account binding before responding. Only now acknowledge to Apple.
            await transaction.finish()
            guard generation == accountGeneration else { return false }
            message = verified.isActive()
                ? "Your membership is active."
                : "This purchase does not currently provide an active membership."
            return verified.isActive()
        } catch {
            guard generation == accountGeneration else { return false }
            message = "Your purchase is saved with Apple, but membership could not be confirmed. Try Restore purchases when you are connected."
            return false
        }
    }
}
