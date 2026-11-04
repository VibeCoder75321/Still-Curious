import SwiftUI

enum CuriousTheme {
    static let background = Color(red: 20 / 255, green: 28 / 255, blue: 25 / 255)
    static let surface = Color(red: 30 / 255, green: 41 / 255, blue: 35 / 255)
    static let sage = Color(red: 197 / 255, green: 215 / 255, blue: 184 / 255)
    static let gold = Color(red: 213 / 255, green: 187 / 255, blue: 145 / 255)
}

@MainActor
struct LibraryView: View {
    @ObservedObject var player: AudioPlayer
    let configuration: AppConfiguration
    let episodes: [Episode]
    let loadError: String?
    @State private var showingPlayer = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("A LITTLE WONDER, BEFORE SLEEP")
                            .font(.caption.weight(.medium)).tracking(2).foregroundStyle(CuriousTheme.sage)
                        Text("Still Curious")
                            .font(.system(size: 40, weight: .regular, design: .serif))
                        Text("Conversations for a mind that likes to wander.")
                            .font(.body).foregroundStyle(.secondary)
                    }.padding(.top, 12)
                    if let loadError {
                        ContentUnavailableView("Library unavailable", systemImage: "books.vertical", description: Text(loadError))
                    } else {
                        ForEach(episodes) { episode in
                            VStack(alignment: .leading, spacing: 14) {
                                HStack {
                                    Label(episode.category ?? "The conversation", systemImage: episode.theme == "chemistry" ? "sparkles" : "waveform")
                                        .font(.caption).foregroundStyle(CuriousTheme.gold)
                                    Spacer()
                                    Image(systemName: "moon.stars").foregroundStyle(CuriousTheme.sage)
                                }
                                Text(episode.title).font(.system(size: 27, weight: .regular, design: .serif))
                                Text(episode.overview).font(.subheadline).foregroundStyle(.secondary)
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(episode.durationLabel).font(.subheadline)
                                        Text(episode.kindLabel).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button {
                                        player.play(episode, configuration: configuration)
                                        showingPlayer = true
                                    } label: {
                                        Label("Listen", systemImage: "play.fill").padding(.vertical, 5)
                                    }.buttonStyle(.borderedProminent).tint(CuriousTheme.sage).foregroundStyle(CuriousTheme.background)
                                }
                            }
                            .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                            .background(CuriousTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                        }
                        Text("The included recordings are saved in the app for offline listening. Voices and specialist characters are AI-generated.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(20)
            }
            .background(CuriousTheme.background)
            .toolbar {
                if player.episode != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Now playing", systemImage: "waveform") { showingPlayer = true }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let episode = player.episode {
                    HStack(spacing: 14) {
                        Button { showingPlayer = true } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("NOW PLAYING").font(.caption2).tracking(1).foregroundStyle(CuriousTheme.sage)
                                Text(episode.title).font(.subheadline).lineLimit(1)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain)
                        Button { player.toggle() } label: {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3).frame(width: 44, height: 44)
                        }.accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    }.padding(.horizontal, 20).padding(.vertical, 10).background(CuriousTheme.surface)
                }
            }
            .sheet(isPresented: $showingPlayer) { PlayerView(player: player) }
        }
    }
}
