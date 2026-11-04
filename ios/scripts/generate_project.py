#!/usr/bin/env python3
"""Regenerate the checked-in Xcode project; no third-party generator required."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "StillCurious.xcodeproj"


def ident(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def quote(value):
    return json.dumps(value)


def generate():
    sources = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "StillCurious").rglob("*.swift"))
    resources = ["StillCurious/Assets.xcassets", "StillCurious/PrivacyInfo.xcprivacy"]
    resources += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "StillCurious/Resources").rglob("*.json"))
    resources += ["../public/audio/dialogue-preview.mp3", "../public/audio/pharmaceutical-opening.mp3"]
    types = {"swift": "sourcecode.swift", "json": "text.json", "mp3": "audio.mp3", "xcprivacy": "text.xml", "xcassets": "folder.assetcatalog"}
    objects = []
    for path in sources + resources:
        kind = types[path.rsplit(".", 1)[-1]]
        objects.append(f'{ident("file:" + path)} = {{isa = PBXFileReference; lastKnownFileType = {kind}; path = {quote(path)}; sourceTree = SOURCE_ROOT; }};')
        objects.append(f'{ident("build:" + path)} = {{isa = PBXBuildFile; fileRef = {ident("file:" + path)}; }};')
    objects.append(f'{ident("product")} = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = StillCurious.app; sourceTree = BUILT_PRODUCTS_DIR; }};')
    objects.append(f'{ident("products")} = {{isa = PBXGroup; children = ({ident("product")},); name = Products; sourceTree = "<group>"; }};')
    children = ",".join(ident("file:" + p) for p in sources + resources)
    objects.append(f'{ident("mainGroup")} = {{isa = PBXGroup; children = ({children},{ident("products")},); sourceTree = "<group>"; }};')
    for kind, files in [("Sources", sources), ("Resources", resources), ("Frameworks", [])]:
        refs = ",".join(ident("build:" + p) for p in files)
        objects.append(f'{ident(kind)} = {{isa = PBX{kind}BuildPhase; buildActionMask = 2147483647; files = ({refs}{"," if refs else ""}); runOnlyForDeploymentPostprocessing = 0; }};')
    common = {"SDKROOT": "iphoneos", "IPHONEOS_DEPLOYMENT_TARGET": "17.0", "SWIFT_VERSION": "5.0", "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES"}
    app = {"ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "CODE_SIGN_STYLE": "Automatic", "CURRENT_PROJECT_VERSION": "1", "GENERATE_INFOPLIST_FILE": "NO", "INFOPLIST_FILE": "StillCurious/Info.plist", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks", "MARKETING_VERSION": "1.0", "PRODUCT_BUNDLE_IDENTIFIER": "com.example.StillCurious", "PRODUCT_NAME": "$(TARGET_NAME)", "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator", "SWIFT_EMIT_LOC_STRINGS": "YES", "TARGETED_DEVICE_FAMILY": "1"}
    for scope in ["project", "target"]:
        configs = []
        for mode in ["Debug", "Release"]:
            key = ident(scope + mode)
            settings = dict(common if scope == "project" else app)
            if scope == "project":
                settings.update({"SWIFT_OPTIMIZATION_LEVEL": "-Onone" if mode == "Debug" else "-O", "DEBUG_INFORMATION_FORMAT": "dwarf" if mode == "Debug" else "dwarf-with-dsym"})
                if mode == "Debug": settings["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG $(inherited)"
            body = " ".join(f"{k} = {quote(v)};" for k, v in sorted(settings.items()))
            objects.append(f'{key} = {{isa = XCBuildConfiguration; buildSettings = {{{body}}}; name = {mode}; }};')
            configs.append(key)
        objects.append(f'{ident(scope + "ConfigList")} = {{isa = XCConfigurationList; buildConfigurations = ({",".join(configs)},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};')
    objects.append(f'{ident("target")} = {{isa = PBXNativeTarget; buildConfigurationList = {ident("targetConfigList")}; buildPhases = ({ident("Sources")},{ident("Frameworks")},{ident("Resources")},); buildRules = (); dependencies = (); name = StillCurious; productName = StillCurious; productReference = {ident("product")}; productType = "com.apple.product-type.application"; }};')
    objects.append(f'{ident("project")} = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; }}; buildConfigurationList = {ident("projectConfigList")}; compatibilityVersion = "Xcode 15.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base,); mainGroup = {ident("mainGroup")}; productRefGroup = {ident("products")}; projectDirPath = ""; projectRoot = ""; targets = ({ident("target")},); }};')
    PROJECT.mkdir(exist_ok=True)
    (PROJECT / "project.pbxproj").write_text("// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 60; objects = {\n" + "\n".join(objects) + f"\n}}; rootObject = {ident('project')}; }}\n")
    schemes = PROJECT / "xcshareddata/xcschemes"
    schemes.mkdir(parents=True, exist_ok=True)
    ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident("target")}" BuildableName="StillCurious.app" BlueprintName="StillCurious" ReferencedContainer="container:StillCurious.xcodeproj"/>'
    (schemes / "StillCurious.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
    print(f"Generated {PROJECT.name}: {len(sources)} Swift sources, {len(resources)} resources")


if __name__ == "__main__":
    generate()
