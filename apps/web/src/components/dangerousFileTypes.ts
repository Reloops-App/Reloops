/**
 * Extensions that can execute code if double-clicked (Windows/macOS/Linux
 * installers, scripts, and native binaries) -- modeled on the well-known
 * "Gmail blocked attachment" list. Generic archives (.zip/.7z/.rar/.tar/.gz),
 * fonts, and all design/document formats are intentionally NOT included --
 * this is a security blocklist, not a content-type allowlist.
 *
 * Kept dependency-free (no `@/` imports) so it can be unit-tested directly
 * under the plain Node test runner.
 */
export const DANGEROUS_EXTENSIONS = new Set([
    // Windows executables / installers
    ".exe", ".msi", ".msix", ".msixbundle", ".appx", ".appxbundle",
    ".dll", ".sys", ".drv", ".vxd", ".cpl", ".scr", ".com", ".pif", ".gadget",
    // Windows scripts / shortcuts
    ".bat", ".cmd", ".vb", ".vbs", ".vbe", ".js", ".jse", ".ws", ".wsf", ".wsh",
    ".ps1", ".ps1xml", ".psc1", ".psm1", ".hta", ".sct", ".shb", ".lnk",
    ".ins", ".isp", ".msp", ".mst", ".msc", ".reg",
    // Java / Android
    ".jar", ".apk",
    // macOS
    ".dmg", ".pkg", ".command", ".workflow", ".action",
    // Linux
    ".deb", ".rpm", ".run",
]);

/**
 * Backstop for the few dangerous types browsers reliably report via
 * File.type, independent of filename/extension. Names match
 * apps/asset-intelligence-worker's UNSUPPORTED_MIME_TYPES for consistency.
 */
export const DANGEROUS_MIME_TYPES = new Set([
    "application/x-msdownload",
    "application/x-dosexec",
    "application/vnd.microsoft.portable-executable",
    "application/vnd.android.package-archive",
    "application/java-archive",
]);

/**
 * True final-extension match only (handles double-extension disguises like
 * "resume.pdf.exe" -- only the segment after the LAST dot counts).
 */
export function isDangerousFile(file: Pick<File, "name" | "type">): boolean {
    const name = String(file.name || "").trim().toLowerCase();
    const lastDot = name.lastIndexOf(".");
    if (lastDot > -1 && lastDot < name.length - 1 && DANGEROUS_EXTENSIONS.has(name.slice(lastDot))) {
        return true;
    }
    const mime = String(file.type || "").trim().toLowerCase().split(";")[0];
    return DANGEROUS_MIME_TYPES.has(mime);
}
