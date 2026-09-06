#ifndef AppVersion
  #error AppVersion must be supplied by package-release.mjs
#endif
#ifndef AppVersionNumeric
  #error AppVersionNumeric must be supplied by package-release.mjs
#endif
#ifndef SourceDir
  #error SourceDir must be supplied by package-release.mjs
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by package-release.mjs
#endif

[Setup]
AppId={{E26CD98C-02CE-4E8A-AF28-1B13FF36C877}
AppName=Tournament Overlay
AppVersion={#AppVersion}
AppVerName=Tournament Overlay {#AppVersion}
AppPublisher=Tournament Overlay
AppPublisherURL=https://github.com/DavidIsrawi/tournament-overlay
AppSupportURL=https://github.com/DavidIsrawi/tournament-overlay/issues
AppUpdatesURL=https://github.com/DavidIsrawi/tournament-overlay/releases
VersionInfoVersion={#AppVersionNumeric}
DefaultDirName={localappdata}\Programs\Tournament Overlay
DefaultGroupName=Tournament Overlay
PrivilegesRequired=lowest
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=tournament-overlay-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
InfoBeforeFile={#SourceDir}\README.txt
UninstallDisplayIcon={app}\app\TournamentOverlay.exe
CloseApplications=no
RestartApplications=no
AllowCancelDuringInstall=no

[InstallDelete]
; app is reserved for the versioned payload, never configuration or operator data.
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "windows-install.marker"; DestDir: "{app}\app"; DestName: ".tournament-overlay-installation"; Flags: ignoreversion
Source: "{#SourceDir}\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Tournament Overlay"; Filename: "{app}\app\TournamentOverlay.exe"; WorkingDir: "{app}\app"
Name: "{group}\Read me"; Filename: "{app}\app\README.txt"
Name: "{group}\Uninstall Tournament Overlay"; Filename: "{uninstallexe}"

[Code]
const
  InvalidHandle = -1;
  GenericReadWrite = $C0000000;
  OpenExisting = 3;
  FileAttributeNormal = $80;
  FileAttributeReparsePoint = $400;
  InvalidFileAttributes = $FFFFFFFF;

function CreateFileW(FileName: string; DesiredAccess, ShareMode: LongWord;
  SecurityAttributes: NativeUInt; CreationDisposition, Flags: LongWord;
  TemplateFile: THandle): THandle;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): BOOL;
  external 'CloseHandle@kernel32.dll stdcall';
function GetFileAttributesW(FileName: string): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function IsReparsePoint(Path: string): Boolean;
var
  Attributes: LongWord;
begin
  Attributes := GetFileAttributesW(Path);
  Result := (Attributes <> InvalidFileAttributes) and
    ((Attributes and FileAttributeReparsePoint) <> 0);
end;

function InstallationProblem(): string;
var
  Executable: string;
  Handle: THandle;
begin
  Result := '';
  if IsReparsePoint(ExpandConstant('{app}')) or
    IsReparsePoint(ExpandConstant('{app}\app')) then
  begin
    Result := 'The installation folder must not be a symbolic link or junction.';
    Exit;
  end;
  if DirExists(ExpandConstant('{app}\app')) and
    not FileExists(ExpandConstant('{app}\app\.tournament-overlay-installation')) then
  begin
    Result := 'The destination app folder is not a recognized Tournament Overlay ' +
      'installation. Move it aside before installing; its files will not be deleted.';
    Exit;
  end;
  Executable := ExpandConstant('{app}\app\TournamentOverlay.exe');
  if not FileExists(Executable) then
    Exit;
  { An exclusive write-capable handle fails for a running executable. Never kill,
    restart, or schedule replacement at reboot; the operator must stop it first. }
  Handle := CreateFileW(Executable, GenericReadWrite, 0, 0, OpenExisting,
    FileAttributeNormal, 0);
  if Handle = THandle(InvalidHandle) then
    Result := 'Tournament Overlay is running or its files are in use. Stop it ' +
      'before continuing (Ctrl+C in its console, or end TournamentOverlay.exe ' +
      'in Task Manager). Closing the browser does not stop the server.'
  else
    CloseHandle(Handle);
end;

function PrepareToInstall(var NeedsRestart: Boolean): string;
begin
  Result := InstallationProblem();
end;

function InitializeUninstall(): Boolean;
var
  Problem: string;
begin
  Problem := InstallationProblem();
  Result := Problem = '';
  if not Result then
    SuppressibleMsgBox(Problem, mbError, MB_OK, IDOK);
end;
