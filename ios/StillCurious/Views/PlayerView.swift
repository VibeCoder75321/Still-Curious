import SwiftUI

@MainActor
struct PlayerView: View {
    @ObservedObject var player: AudioPlayer
    @Environment(\.dismiss) private var dismiss
    @State private var isSeeking = false
    @State private var seekPosition: Double = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                if let episode = player.episode {
                    VStack(alignment: .leading, spacing: 26) {
                        Image(systemName: "moon.stars")
                            .font(.system(size: 70, weight: .ultraLight)).foregroundStyle(CuriousTheme.gold)
                            .frame(maxWidth: .infinity).frame(height: 180)
                            .background(CuriousTheme.surface, in: RoundedRectangle(cornerRadius: 24))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 12) {
                            Text(episode.title).font(.system(size: 31, weight: .regular, design: .serif))
                            Text(episode.overview).foregroundStyle(.secondary)
                        }
                        VStack(spacing: 8) {
                            Slider(value: Binding(get: { isSeeking ? seekPosition : player.currentTime }, set: { seekPosition = $0 }),
                                   in: 0...max(1, player.duration), onEditingChanged: { editing in
                                if editing { seekPosition = player.currentTime; isSeeking = true }
                                else { player.seek(to: seekPosition); isSeeking = false }
                            }).accessibilityLabel("Playback position")
                            HStack {
                                Text(clock(isSeeking ? seekPosition : player.currentTime))
                                Spacer()
                                Text(clock(player.duration))
                            }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 38) {
                            Button { player.skip(seconds: -15) } label: { Image(systemName: "gobackward.15").font(.largeTitle).frame(width: 48, height: 48) }.accessibilityLabel("Back 15 seconds")
                            Button { player.toggle() } label: {
                                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                    .font(.title).foregroundStyle(CuriousTheme.background).frame(width: 72, height: 72)
                                    .background(CuriousTheme.sage, in: Circle())
                            }.accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                            Button { player.skip(seconds: 15) } label: { Image(systemName: "goforward.15").font(.largeTitle).frame(width: 48, height: 48) }.accessibilityLabel("Forward 15 seconds")
                        }.frame(maxWidth: .infinity)
                        HStack {
                            Menu {
                                ForEach(AudioPlayer.supportedRates, id: \.self) { rate in
                                    Button(rateLabel(rate)) { player.setRate(rate) }
                                }
                            } label: { Label(rateLabel(player.playbackRate), systemImage: "speedometer").frame(minHeight: 44) }
                            Spacer()
                            Menu {
                                Button("Off") { player.setSleepTimer(minutes: nil) }
                                ForEach([15, 30, 45], id: \.self) { minutes in
                                    Button("\(minutes) minutes") { player.setSleepTimer(minutes: minutes) }
                                }
                            } label: {
                                Label(player.sleepRemaining.map { "Sleep in \(clock($0))" } ?? "Sleep timer", systemImage: "moon.zzz")
                                    .frame(minHeight: 44)
                            }
                        }.font(.subheadline)
                        if let error = player.errorMessage { Text(error).foregroundStyle(.orange).accessibilityAddTraits(.updatesFrequently) }
                        if !episode.readingList.isEmpty {
                            DisclosureGroup("Reading list") {
                                VStack(alignment: .leading, spacing: 14) {
                                    Text(episode.readingNote).font(.footnote).foregroundStyle(.secondary)
                                    ForEach(episode.readingList) { source in
                                        if let url = source.linkURL { Link(source.title, destination: url).font(.subheadline).frame(minHeight: 44, alignment: .leading) }
                                    }
                                }.padding(.top, 12)
                            }
                        }
                    }.padding(24)
                }
            }
            .background(CuriousTheme.background)
            .navigationTitle("Now playing").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }

    private func clock(_ seconds: Double) -> String {
        let safe = seconds.isFinite ? max(0, Int(seconds)) : 0
        return String(format: "%d:%02d", safe / 60, safe % 60)
    }
    private func rateLabel(_ rate: Float) -> String { String(format: "%g×", rate) }
}
