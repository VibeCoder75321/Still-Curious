import SwiftUI

@main
@MainActor
struct StillCuriousApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var player = AudioPlayer()
    @StateObject private var subscriptions: SubscriptionStore
    private let configuration: AppConfiguration
    private let episodes: [Episode]
    private let loadError: String?

    init() {
        let configuration = AppConfiguration.load()
        self.configuration = configuration
        _subscriptions = StateObject(wrappedValue: SubscriptionStore(productID: configuration.subscriptionProductID))
        do {
            episodes = try Episode.loadLibrary()
            loadError = nil
        } catch {
            episodes = []
            loadError = error.localizedDescription
        }
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                LibraryView(player: player, configuration: configuration, episodes: episodes, loadError: loadError)
                    .tabItem { Label("Listen", systemImage: "books.vertical") }
                NavigationStack {
                    ContentUnavailableView {
                        Label("Your next conversation", systemImage: "sparkles")
                    } description: {
                        Text("Personal episode creation is not available in this build. Enjoy the included listening library while we prepare subscriptions.")
                    }
                    .background(CuriousTheme.background)
                    .navigationTitle("Create")
                }.tabItem { Label("Create", systemImage: "sparkles") }
                SubscriptionView(store: subscriptions, privacyURL: configuration.privacyURL, termsURL: configuration.termsURL)
                    .tabItem { Label("Membership", systemImage: "person.crop.circle") }
                NavigationStack {
                    List {
                        Section("About Still Curious") {
                            Text("Calm conversations about science and discovery. Voices and specialist characters are AI-generated.")
                            Text("Included excerpts are for general interest and are not medical advice.")
                        }
                        Section("Help and privacy") {
                            if let url = configuration.supportURL { Link("Contact support", destination: url) }
                            if let url = configuration.privacyURL { Link("Privacy policy", destination: url) }
                            if let url = configuration.termsURL { Link("Terms of use", destination: url) }
                            Button("Clear listening history on this device", role: .destructive) { player.clearSavedListeningData() }
                        }
                    }.navigationTitle("Settings")
                }.tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .tint(CuriousTheme.sage)
            .preferredColorScheme(.dark)
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { player.synchronizeAfterForeground() }
            }
        }
    }
}
