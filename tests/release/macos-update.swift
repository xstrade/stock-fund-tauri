import AppKit
import ApplicationServices
import Foundation

struct TestFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

func find(_ element: AXUIElement, role: String, label: String) -> AXUIElement? {
    let labels = [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute]
    if attribute(element, kAXRoleAttribute) as? String == role,
       labels.contains(where: { attribute(element, $0) as? String == label }) {
        return element
    }
    for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        if let match = find(child, role: role, label: label) { return match }
    }
    return nil
}

func wait<T>(_ description: String, seconds: TimeInterval = 45, _ value: () -> T?) throws -> T {
    let deadline = Date().addingTimeInterval(seconds)
    repeat {
        if let result = value() { return result }
        Thread.sleep(forTimeInterval: 0.5)
    } while Date() < deadline
    throw TestFailure("Timed out waiting for \(description)")
}

func element(_ app: AXUIElement, _ role: String, _ label: String, seconds: TimeInterval = 45) throws -> AXUIElement {
    try wait(label, seconds: seconds) { find(app, role: role, label: label) }
}

func press(_ element: AXUIElement) throws {
    let status = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard status == .success else { throw TestFailure("AXPress failed: \(status.rawValue)") }
}

func checked(_ element: AXUIElement) -> Bool {
    (attribute(element, kAXValueAttribute) as? NSNumber)?.boolValue == true
}

func installedVersion(_ path: String) -> String? {
    let url = URL(fileURLWithPath: path).appendingPathComponent("Contents/Info.plist")
    return NSDictionary(contentsOf: url)?["CFBundleShortVersionString"] as? String
}

func test() throws {
    guard AXIsProcessTrusted() else {
        throw TestFailure("Runner does not grant Accessibility permission to the macOS test process")
    }
    let path = CommandLine.arguments[1]
    let bundleID = "org.stockfund.desktop"
    func running() -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first
    }
    guard installedVersion(path) == "0.1.0" else {
        throw TestFailure("Expected v0.1.0 installed from the public DMG")
    }
    let original = try wait("v0.1.0 app launch") { running() }
    let originalUI = AXUIElementCreateApplication(original.processIdentifier)
    try press(element(originalUI, kAXButtonRole, "设置"))
    for name in ["精简列表", "窗口置顶"] {
        let checkbox = try element(originalUI, kAXCheckBoxRole, name)
        if !checked(checkbox) { try press(checkbox) }
        guard checked(checkbox) else { throw TestFailure("Could not set \(name)") }
    }
    try press(element(originalUI, kAXButtonRole, "保存设置"))
    print("v0.1.0 started and test settings saved.")
    _ = try element(originalUI, kAXStaticTextRole, "发现新版本 0.1.1", seconds: 100)
    try press(element(originalUI, kAXButtonRole, "下载并安装"))
    try press(element(originalUI, kAXButtonRole, "重新启动", seconds: 240))

    let updated = try wait("v0.1.1 app restart", seconds: 90) {
        running().flatMap { $0.processIdentifier == original.processIdentifier ? nil : $0 }
    }
    guard installedVersion(path) == "0.1.1" else {
        throw TestFailure("Restarted bundle is not v0.1.1")
    }
    let updatedUI = AXUIElementCreateApplication(updated.processIdentifier)
    try press(element(updatedUI, kAXButtonRole, "设置"))
    for name in ["精简列表", "窗口置顶"] {
        let checkbox = try element(updatedUI, kAXCheckBoxRole, name)
        guard checked(checkbox) else { throw TestFailure("Setting was lost: \(name)") }
    }
    print("v0.1.1 downloaded, installed and relaunched. Both settings were retained.")
}

do {
    try test()
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
