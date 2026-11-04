import AVFoundation
import Combine
import Foundation
import MediaPlayer

/// One app-wide player owns audio focus, lock-screen controls, and the native sleep timer.
@MainActor
final class AudioPlayer: ObservableObject {
    @Published private(set) var episode: Episode?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var playbackRate: Float
    @Published private(set) var sleepRemaining: TimeInterval?
    @Published private(set) var errorMessage: String?

    static let supportedRates: [Float] = [0.6, 0.7, 0.8, 0.9, 1, 1.2]
    private let player = AVPlayer()
    private let defaults: UserDefaults
    private var timeObserver: Any?
    private var itemStatusObserver: NSKeyValueObservation?
    private var notificationObservers: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var sleepTimer: DispatchSourceTimer?
    private var sleepDeadline: Date?
    private var lastSavedSecond = -1
    private var seekGeneration = UUID()
    private var isSeeking = false
    private var resumeAfterInterruption = false
    private let rateKey = "still-curious-playback-rate"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.float(forKey: rateKey)
        playbackRate = Self.supportedRates.contains(stored) ? stored : 1
        configureRemoteControls()
        observeSession()
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.isSeeking else { return }
                // A callback queued before replacing an item must not save the
                // old recording's time against the newly selected episode.
                let seconds = self.player.currentTime().seconds
                self.currentTime = max(0, seconds.isFinite ? seconds : 0)
                let itemDuration = self.player.currentItem?.duration.seconds ?? 0
                if itemDuration.isFinite && itemDuration > 0 { self.duration = itemDuration }
                self.isPlaying = self.player.timeControlStatus == .playing
                self.checkSleepTimer()
                self.savePositionIfNeeded()
                self.updateNowPlaying()
            }
        }
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        for observer in notificationObservers { NotificationCenter.default.removeObserver(observer) }
        for (command, target) in remoteTargets { command.removeTarget(target) }
        sleepTimer?.cancel()
    }

    func play(_ selected: Episode, configuration: AppConfiguration) {
        errorMessage = nil
        guard let url = selected.audioURL(configuration: configuration) else {
            errorMessage = "This recording is unavailable. Please try another episode."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
        } catch {
            errorMessage = "Audio could not start. Please check your audio output and try again."
            return
        }
        if episode?.id != selected.id {
            savePosition()
            player.pause()
            seekGeneration = UUID()
            isSeeking = false
            episode = selected
            duration = selected.durationSeconds
            currentTime = 0
            lastSavedSecond = -1
            let item = AVPlayerItem(url: url)
            itemStatusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                let failed = item.status == .failed
                if failed {
                    Task { @MainActor [weak self] in
                        guard let self, self.player.currentItem === item else { return }
                        self.pause()
                        self.errorMessage = "This recording could not be loaded. Please try again."
                    }
                }
            }
            player.replaceCurrentItem(with: item)
            let saved = defaults.double(forKey: positionKey(selected.id))
            if saved.isFinite && saved > 0 && saved < selected.durationSeconds - 3 {
                seek(to: saved)
            }
        }
        resume()
    }

    func toggle() {
        if isPlaying { pause() } else { resume() }
    }

    func resume() {
        guard episode != nil, player.currentItem != nil else { return }
        do { try AVAudioSession.sharedInstance().setActive(true) }
        catch { errorMessage = "Audio could not resume. Please try again."; return }
        checkSleepTimer()
        player.playImmediately(atRate: playbackRate)
        isPlaying = true
        updateNowPlaying()
    }

    func pause() {
        player.pause()
        isPlaying = false
        savePosition()
        updateNowPlaying()
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite else { return }
        let clamped = min(max(0, seconds), duration > 0 ? duration : max(0, seconds))
        let generation = UUID()
        seekGeneration = generation
        isSeeking = true
        currentTime = clamped
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            Task { @MainActor [weak self] in
                guard let self, self.seekGeneration == generation else { return }
                self.isSeeking = false
                if finished {
                    self.currentTime = clamped
                    self.savePosition()
                    self.updateNowPlaying()
                }
            }
        }
        updateNowPlaying()
    }

    func skip(seconds: Double) { seek(to: currentTime + seconds) }

    func setRate(_ rate: Float) {
        guard Self.supportedRates.contains(rate) else { return }
        playbackRate = rate
        defaults.set(rate, forKey: rateKey)
        if isPlaying { player.rate = rate }
        updateNowPlaying()
    }

    /// Native wall-clock timer continues while the app is playing background audio.
    func setSleepTimer(minutes: Int?) {
        sleepTimer?.cancel()
        sleepTimer = nil
        guard let minutes, [15, 30, 45].contains(minutes) else {
            sleepDeadline = nil
            sleepRemaining = nil
            return
        }
        sleepDeadline = Date().addingTimeInterval(TimeInterval(minutes * 60))
        sleepRemaining = TimeInterval(minutes * 60)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in
            Task { @MainActor [weak self] in self?.checkSleepTimer() }
        }
        sleepTimer = timer
        timer.resume()
    }

    func synchronizeAfterForeground() {
        checkSleepTimer()
        isPlaying = player.timeControlStatus == .playing
        updateNowPlaying()
    }

    func clearSavedListeningData() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("still-curious-position-") || key == rateKey {
            defaults.removeObject(forKey: key)
        }
        playbackRate = 1
        if isPlaying { player.rate = 1 }
        updateNowPlaying()
    }

    private func positionKey(_ id: String) -> String { "still-curious-position-\(id)" }

    private func savePositionIfNeeded() {
        let second = Int(currentTime)
        if second % 5 == 0 && lastSavedSecond != second { savePosition(); lastSavedSecond = second }
    }

    private func savePosition() {
        guard let episode else { return }
        defaults.set(currentTime.isFinite ? currentTime : 0, forKey: positionKey(episode.id))
    }

    private func checkSleepTimer() {
        guard let deadline = sleepDeadline else { return }
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 {
            resumeAfterInterruption = false
            setSleepTimer(minutes: nil)
            pause()
        } else { sleepRemaining = remaining }
    }

    private func updateNowPlaying() {
        guard let episode else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: episode.title,
            MPMediaItemPropertyArtist: "Still Curious",
            MPMediaItemPropertyAlbumTitle: "A conversation for a curious mind",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? playbackRate : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: playbackRate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
    }

    private func configureRemoteControls() {
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            remoteTargets.append((command, command.addTarget(handler: handler)))
        }
        add(center.playCommand) { [weak self] _ in
            Task { @MainActor [weak self] in self?.resume() }; return .success
        }
        add(center.pauseCommand) { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }; return .success
        }
        add(center.togglePlayPauseCommand) { [weak self] _ in
            Task { @MainActor [weak self] in self?.toggle() }; return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.preferredIntervals = [15]
        add(center.skipBackwardCommand) { [weak self] _ in
            Task { @MainActor [weak self] in self?.skip(seconds: -15) }; return .success
        }
        add(center.skipForwardCommand) { [weak self] _ in
            Task { @MainActor [weak self] in self?.skip(seconds: 15) }; return .success
        }
        add(center.changePlaybackPositionCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor [weak self] in self?.seek(to: position) }; return .success
        }
        center.changePlaybackRateCommand.supportedPlaybackRates = Self.supportedRates.map { NSNumber(value: $0) }
        add(center.changePlaybackRateCommand) { [weak self] event in
            guard let event = event as? MPChangePlaybackRateCommandEvent else { return .commandFailed }
            let rate = event.playbackRate
            Task { @MainActor [weak self] in self?.setRate(rate) }; return .success
        }
    }

    private func observeSession() {
        let notifications = NotificationCenter.default
        notificationObservers.append(notifications.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] notification in
            Task { @MainActor [weak self] in
                guard let self, let item = notification.object as? AVPlayerItem, item === self.player.currentItem else { return }
                self.isPlaying = false
                self.player.seek(to: .zero)
                self.currentTime = 0
                self.savePosition()
                self.setSleepTimer(minutes: nil)
                self.updateNowPlaying()
            }
        })
        notificationObservers.append(notifications.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let typeRaw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let optionRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            Task { @MainActor [weak self] in
                guard let self, let typeRaw, let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
                if type == .began {
                    self.resumeAfterInterruption = self.isPlaying
                    self.pause()
                } else {
                    self.checkSleepTimer()
                    let shouldResume = self.resumeAfterInterruption && AVAudioSession.InterruptionOptions(rawValue: optionRaw).contains(.shouldResume)
                    self.resumeAfterInterruption = false
                    if shouldResume { self.resume() }
                }
            }
        })
        notificationObservers.append(notifications.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                Task { @MainActor [weak self] in self?.pause() }
            }
        })
    }
}
