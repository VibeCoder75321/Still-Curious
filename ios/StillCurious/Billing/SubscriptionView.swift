import StoreKit
import SwiftUI

@MainActor
struct SubscriptionView: View {
    @ObservedObject var store: SubscriptionStore
    let privacyURL: URL?
    let termsURL: URL?
    @Environment(\.scenePhase) private var scenePhase

    private var legalLinksReady: Bool {
        isPublicHTTPS(privacyURL) && isPublicHTTPS(termsURL)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Keep your curiosity company")
                            .font(.largeTitle.bold())
                        Text("Personal science conversations, made for unhurried listening.")
                            .foregroundStyle(.secondary)
                    }

                    if let entitlement = store.entitlement, entitlement.isActive() {
                        Label("Membership active", systemImage: "checkmark.seal.fill")
                        if let remaining = entitlement.remainingEpisodes {
                            Text("Episodes remaining this period: \(remaining)")
                        }
                        if let expires = entitlement.expiresAt {
                            Text("Current access ends \(expires.formatted(date: .abbreviated, time: .omitted)).")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let product = store.product, let subscription = product.subscription {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(product.displayName).font(.title2.bold())
                            Text(product.description)
                            if let summary = store.planSummary {
                                Text(summary)
                            }
                            Text("\(product.displayPrice) every \(periodDescription(subscription.subscriptionPeriod))")
                                .font(.headline)
                            Button {
                                Task { await store.purchase() }
                            } label: {
                                Text("Subscribe for \(product.displayPrice)")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .disabled(!store.canPurchase || !legalLinksReady)
                        }
                        .padding()
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 20))
                    } else if store.isLoading {
                        ProgressView("Loading membership…")
                    } else if !store.productID.isEmpty {
                        Button("Try loading membership again") {
                            Task { await store.loadProducts() }
                        }
                    }

                    if !store.isConfigured {
                        Text("Subscriptions are not available in this build yet. You can still listen to the free library.")
                            .foregroundStyle(.secondary)
                    } else if !legalLinksReady {
                        Text("Subscriptions are temporarily unavailable. Please try again in a later app update.")
                            .foregroundStyle(.secondary)
                    }

                    if let message = store.message {
                        Text(message)
                    }
                    if store.isBusy {
                        ProgressView("Checking membership…")
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        Button("Restore purchases") {
                            Task { await store.restorePurchases() }
                        }
                        .disabled(store.isBusy || !store.isConfigured)
                        ManageSubscriptionButton()
                        Text("Payment is charged to your Apple account when you confirm a purchase. Subscriptions renew automatically unless cancelled at least 24 hours before the current period ends. Manage or cancel your subscription in your Apple account settings. Cancelling a subscription does not delete your Still Curious account.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        HStack(spacing: 20) {
                            if let privacyURL, isPublicHTTPS(privacyURL) {
                                Link("Privacy policy", destination: privacyURL)
                            }
                            if let termsURL, isPublicHTTPS(termsURL) {
                                Link("Terms of use", destination: termsURL)
                            }
                        }
                        .font(.footnote)
                    }
                }
                .padding(24)
            }
            .navigationTitle("Membership")
            .navigationBarTitleDisplayMode(.inline)
            .task { await store.loadProducts() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await store.recoverTransactions() }
                }
            }
        }
    }

    private func isPublicHTTPS(_ url: URL?) -> Bool {
        guard let url, url.scheme?.lowercased() == "https", let host = url.host,
              !host.isEmpty, host != "localhost", host != "127.0.0.1",
              url.user == nil, url.password == nil else { return false }
        return true
    }

    private func periodDescription(_ period: Product.SubscriptionPeriod) -> String {
        let singular: String
        switch period.unit {
        case .day: singular = "day"
        case .week: singular = "week"
        case .month: singular = "month"
        case .year: singular = "year"
        @unknown default: return "subscription period"
        }
        return period.value == 1 ? singular : "\(period.value) \(singular)s"
    }
}

private struct ManageSubscriptionButton: View {
    @State private var showingManagement = false

    var body: some View {
        Button("Manage or cancel subscription") {
            showingManagement = true
        }
        .manageSubscriptionsSheet(isPresented: $showingManagement)
    }
}
