; --- GEST-IN-SITU Windows Installer Script (Inno Setup) ---
#define AppVersion GetEnv("APP_VERSION")

[Setup]
; 🚨 CRUCIAL : AppId génère le GUID unique pour que Windows et Inno Setup 
; détectent et écrasent proprement l'ancienne version au même emplacement.
AppId={{A1B2C3D4-E5F6-7A8B-9C0D-E1F2A3B4C5D6}
AppName=GEST-IN-SITU
AppVersion={#AppVersion}
AppPublisher=EBYCHOCO
AppPublisherURL=https://github.com/ebycoco/GEST-IN-SITU
DefaultDirName={localappdata}\Programs\GEST-IN-SITU
DisableProgramGroupPage=yes
MinVersion=6.1
ArchitecturesAllowed=x64
PrivilegesRequired=lowest
OutputDir=out\make\installer
OutputBaseFilename=GEST_CARTE_IN-SITU-Setup-v{#AppVersion}
SetupIconFile=resources\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
VersionInfoVersion={#AppVersion}
VersionInfoTextVersion={#AppVersion}
VersionInfoCompany=EBYCHOCO
VersionInfoDescription=GEST-IN-SITU Installer
VersionInfoCopyright=Copyright (C) 2026 EBYCHOCO
UninstallDisplayIcon={app}\gest-in-situ.exe

; --- SÉCURITÉ MISE À JOUR & ÉCRASEMENT ---
; Détecte si une ancienne version existe et gère la superposition
; Force la fermeture agressive des instances existantes lors d'une réinstallation
CloseApplications=yes
RestartApplications=no
AppMutex=GEST-IN-SITU-Mutex-Unique

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; ✅ ignoreversion et deleteafterinstall assurent que les fichiers obsolètes sautent
Source: "out\GEST-IN-SITU-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\GEST-IN-SITU"; Filename: "{app}\gest-in-situ.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\GEST-IN-SITU"; Filename: "{app}\gest-in-situ.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\gest-in-situ.exe"; Description: "{cm:LaunchProgram,GEST-IN-SITU}"; Flags: nowait postinstall skipifsilent runasoriginaluser; WorkingDir: "{app}"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\*"
Type: dirifempty; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\gest-in-situ\*"
Type: filesandordirs; Name: "{userappdata}\gest-in-situ"

; --- SCRIPT DE NETTOYAGE FORCÉ ET ÉCRASEMENT ---
[Code]
procedure ClearIconCache();
var
  ResultCode: Integer;
  Version: TWindowsVersion;
begin
  GetWindowsVersionEx(Version);
  if Version.Major >= 10 then
  begin
    Exec('ie4uinit.exe', '-ClearIconCache', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end
  else
  begin
    Exec('ie4uinit.exe', '-show', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  Exec('taskkill', '/f /im gest-in-situ.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ✅ CETTE PROCÉDURE S'OCCUPE D'ÉCRASER ET DE NETTOYER AVANT L'INSTALLATION
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  // Étape juste avant l'extraction des nouveaux fichiers
  if CurStep = ssInstall then
  begin
    // 1. On tue de force toute instance fantôme de l'ancienne version qui bloquerait le dossier
    Exec('taskkill', '/f /im gest-in-situ.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    
    // 2. On purge l'ancien dossier pour partir sur du propre (évite les fichiers résiduels)
    DelTree(ExpandConstant('{app}'), True, True, True);
  end;

  if CurStep = ssPostInstall then
  begin
    ClearIconCache();
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    // Nettoyer entièrement le dossier de données de l'application dans APPDATA
    // ExpandConstant('{userappdata}\gest-in-situ') pointe sur %APPDATA%\gest-in-situ
    DelTree(ExpandConstant('{userappdata}\gest-in-situ'), True, True, True);
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    ClearIconCache();
  end;
end;