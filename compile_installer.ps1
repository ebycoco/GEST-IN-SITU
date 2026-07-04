$ProjectRoot = 'D:\Espace travail\GEST_IN-SITU_CARTE_ABOBO_V2'
$IssPath = Join-Path $ProjectRoot 'installer.iss'
$TempDir = 'C:\Users\EBYCHOCO\.gemini\antigravity-ide\brain\94bd7e97-8ea8-47e1-ba4c-a9601587039d\scratch\inno-portable'

# 1. Rechercher ISCC.exe localement
$IsccPaths = @(
    (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

$Iscc = $null
foreach ($path in $IsccPaths) {
    if ($path -and (Test-Path $path)) {
        $Iscc = $path
        break
    }
}

# 2. Si non trouvé, utiliser le dossier temporaire
if ($null -eq $Iscc) {
    Write-Host "[INFO] Compilateur Inno Setup non detecte localement. Utilisation de la version portable..."
    if (!(Test-Path $TempDir)) {
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    }
    
    $ZipPath = Join-Path $TempDir "is.zip"
    
    if (!(Test-Path (Join-Path $TempDir "ISCC.exe"))) {
        Write-Host "[INFO] Telechargement d'Inno Setup Portable (JRSoftware)..."
        $WebClient = New-Object System.Net.WebClient
        try {
            $WebClient.DownloadFile("https://files.jrsoftware.org/is/6/is.zip", $ZipPath)
            Write-Host "[INFO] Extraction d'Inno Setup..."
            Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force
            Remove-Item $ZipPath
        } catch {
            Write-Host "[ERREUR] Erreur de telechargement d'Inno Setup portable."
            Write-Host "[CONSEIL] Veuillez installer Inno Setup manuellement : https://jrsoftware.org/isdl.php"
            exit 1
        }
    }
    $Iscc = Join-Path $TempDir "ISCC.exe"
}

# 3. Compiler l'installateur
if (Test-Path $Iscc) {
    Write-Host "[DEBUT] Compilation de l'installateur avec Inno Setup..."
    Write-Host "   Compilateur : $Iscc"
    Write-Host "   Script : $IssPath"
    
    # Creer le repertoire de sortie s'il n'existe pas
    $OutDir = Join-Path $ProjectRoot "out\make\installer"
    if (!(Test-Path $OutDir)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }
    
    Start-Process -FilePath $Iscc -ArgumentList "`"$IssPath`"" -Wait -NoNewWindow
    
    $SetupPath = Join-Path $OutDir "GEST-IN-SITU-Setup.exe"
    if (Test-Path $SetupPath) {
        Write-Host "=========================================================="
        Write-Host "[SUCCES] INSTALLATEUR Windows cree avec succes !"
        Write-Host "   Fichier : $SetupPath"
        Write-Host "=========================================================="
    } else {
        Write-Host "[ERREUR] Echec de la compilation de l'installateur."
    }
} else {
    Write-Host "[ERREUR] Impossible de localiser le compilateur ISCC.exe."
}
