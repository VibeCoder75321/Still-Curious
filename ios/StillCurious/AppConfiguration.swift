import Foundation

/// Public application configuration. Provider credentials never belong in the app bundle.
struct AppConfiguration {
    let serverOrigin: URL
    let subscriptionProductID: String
    let privacyURL: URL?
    let termsURL: URL?
    let supportURL: URL?

    static func load(bundle: Bundle = .main) -> AppConfiguration {
        func string(_ key: String) -> String {
            (bundle.object(forInfoDictionaryKey: key) as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        func secureURL(_ key: String) -> URL? {
            validatedHTTPSURL(string(key))
        }
        let defaultOrigin = URL(string: "https://still-curious-bedtime.workspace-066083.chatgpt.site")!
        let configuredOrigin = secureURL("StillCuriousServerOrigin")
        let origin = configuredOrigin.flatMap { url -> URL? in
            guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  parts.path.isEmpty || parts.path == "/",
                  parts.query == nil, parts.fragment == nil else { return nil }
            return url
        }
        return AppConfiguration(
            serverOrigin: origin ?? defaultOrigin,
            subscriptionProductID: string("StillCuriousSubscriptionProductID"),
            privacyURL: secureURL("StillCuriousPrivacyURL"),
            termsURL: secureURL("StillCuriousTermsURL"),
            supportURL: secureURL("StillCuriousSupportURL")
        )
    }

    static func validatedHTTPSURL(_ value: String) -> URL? {
        guard let url = URL(string: value), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil || parts.port == 443 else { return nil }
        return url
    }
}
