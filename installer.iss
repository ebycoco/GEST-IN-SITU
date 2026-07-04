; --- GEST-IN-SITU Windows Installer Script (Inno Setup) ---
[Setup]
AppName=GEST-IN-SITU
AppVersion=1.0.0
AppPublisher=EBYCHOCO
AppPublisherURL=https://github.com/ebycoco/GEST-IN-SITU
DefaultDirName={autopf}\GEST-IN-SITU
DisableProgramGroupPage=yes
OutputDir=out\make\installer
OutputBaseFilename=GEST-IN-SITU-Setup
SetupIconFile=resources\icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "out\GEST-IN-SITU-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\GEST-IN-SITU"; Filename: "{app}\GEST-IN-SITU.exe"; IconFilename: "{app}\resources\app\resources\icon.ico"
Name: "{userdesktop}\GEST-IN-SITU"; Filename: "{app}\GEST-IN-SITU.exe"; IconFilename: "{app}\resources\app\resources\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\GEST-IN-SITU.exe"; Description: "{cm:LaunchProgram,GEST-IN-SITU}"; Flags: nowait postinstall skipifsilent