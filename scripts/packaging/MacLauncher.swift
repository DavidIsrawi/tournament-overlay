import AppKit

final class MacLauncher: NSObject, NSApplicationDelegate {
    private var server: Process?
    private var dashboardURL: URL?
    private var openOnReady = true
    private var quitting = false
    private var failed = false
    private var outputBuffer = Data()
    private var diagnostics = ""
    private var startupTimer: Timer?
    private var signals: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("launcher-started \(ProcessInfo.processInfo.processIdentifier)")
        fflush(stdout)
        installMenu()
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signals.append(source)
        }

        let process = Process()
        let executable = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/TournamentOverlay")
        process.executableURL = executable
        process.currentDirectoryURL = executable.deletingLastPathComponent()
        var environment = ProcessInfo.processInfo.environment
        environment["OPEN_BROWSER"] = "false"
        if environment["PUBLIC_DIRECTORY"] == nil {
            environment["PUBLIC_DIRECTORY"] = Bundle.main.bundleURL
                .appendingPathComponent("Contents/Resources/public").path
        }
        process.environment = environment

        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.receiveOutput(data) }
        }
        errors.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                guard let self else { return }
                self.diagnostics = String((self.diagnostics + String(decoding: data, as: UTF8.self)).suffix(8_192))
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                self.startupTimer?.invalidate()
                if self.quitting {
                    NSApp.reply(toApplicationShouldTerminate: true)
                } else {
                    self.fail("The local server stopped (exit \(process.terminationStatus)).\n\n\(self.diagnostics)")
                }
            }
        }
        server = process
        do {
            try process.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            fail("The bundled server could not start: \(error.localizedDescription)")
            return
        }
        startupTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            self?.fail("The local server did not become ready. Check for another running copy or a port conflict.\n\n\(self?.diagnostics ?? "")")
        }
    }

    // Finder sends a reopen Apple event to the existing app, not a second process.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openDashboard()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        startupTimer?.invalidate()
        guard let server, server.isRunning else { return .terminateNow }
        if !quitting {
            quitting = true
            server.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self, let server = self.server, server.isRunning else { return }
                let alert = NSAlert()
                alert.messageText = "The local server is still stopping"
                alert.informativeText = "Stopping it now will end the broadcast connection. Unsaved changes may be lost."
                alert.addButton(withTitle: "Keep waiting")
                alert.addButton(withTitle: "Stop now")
                if alert.runModal() == .alertSecondButtonReturn && server.isRunning {
                    kill(server.processIdentifier, SIGKILL)
                }
            }
        }
        return .terminateLater
    }

    private func receiveOutput(_ data: Data) {
        guard dashboardURL == nil, !quitting, !failed else { return }
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.prefix(upTo: newline)
            outputBuffer.removeSubrange(...newline)
            guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  message["msg"] as? String == "Tournament Overlay is ready",
                  let address = message["dashboardUrl"] as? String,
                  let url = URL(string: address), url.scheme == "http", url.host == "127.0.0.1"
            else { continue }
            dashboardURL = url
            startupTimer?.invalidate()
            if openOnReady { openDashboard() }
        }
        if outputBuffer.count > 65_536 { outputBuffer.removeAll() }
    }

    @objc private func openDashboard() {
        guard !quitting, !failed else { return }
        guard let dashboardURL else { openOnReady = true; return }
        openOnReady = false
        print("dashboard-requested \(dashboardURL.absoluteString)")
        fflush(stdout)
        if ProcessInfo.processInfo.environment["OPEN_BROWSER"] != "false" &&
            !NSWorkspace.shared.open(dashboardURL) {
            let alert = NSAlert()
            alert.messageText = "The dashboard could not be opened"
            alert.informativeText = "The server is still running. Open \(dashboardURL.absoluteString) in your browser."
            alert.runModal()
        }
    }

    private func installMenu() {
        let menu = NSMenu()
        let application = NSMenuItem()
        let actions = NSMenu()
        let open = NSMenuItem(title: "Open dashboard", action: #selector(openDashboard), keyEquivalent: "o")
        open.target = self
        actions.addItem(open)
        actions.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Tournament Overlay", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        actions.addItem(quit)
        application.submenu = actions
        menu.addItem(application)
        NSApp.mainMenu = menu
    }

    private func fail(_ message: String) {
        guard !failed, !quitting else { return }
        failed = true
        startupTimer?.invalidate()
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Tournament Overlay could not stay running"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = MacLauncher()
application.setActivationPolicy(.regular)
application.delegate = delegate
withExtendedLifetime(delegate) {
    application.run()
}
