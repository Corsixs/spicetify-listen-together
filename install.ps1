# Instalador de Spotify Together Rework (la app "Listen Together" de Spicetify) para Windows.
# Uso, en PowerShell sin permisos de administrador:
#   iwr -useb https://raw.githubusercontent.com/Corsixs/spicetify-listen-together/main/install.ps1 | iex
#
# Descarga la carpeta listen-together de este repositorio, la copia en CustomApps de Spicetify,
# la activa y ejecuta "spicetify apply", que reinicia Spotify. Sirve tambien para actualizar.
# Los textos van sin tildes para que se vean bien en cualquier consola.

# Todo va dentro de un bloque: con "iex" no quedan variables sueltas en la sesion
# y "return" termina el instalador sin cerrar la ventana
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo = 'Corsixs/spicetify-listen-together'
    $app = 'listen-together'

    Write-Host 'Spotify Together Rework - instalador' -ForegroundColor Cyan

    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host 'Spicetify no funciona como administrador. Abre PowerShell normal (sin "Ejecutar como administrador") y vuelve a pegar el comando.' -ForegroundColor Red
        return
    }

    $command = Get-Command spicetify -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $spicetify = if ($command) { $command.Source } else { Join-Path $env:LOCALAPPDATA 'spicetify\spicetify.exe' }
    if (-not (Test-Path $spicetify)) {
        Write-Host 'No se encontro Spicetify. Instalalo primero: https://spicetify.app/docs/getting-started' -ForegroundColor Red
        return
    }

    # Carpeta de datos de Spicetify, la que contiene CustomApps
    $userdata = $null
    try { $userdata = & $spicetify path userdata | Select-Object -Last 1 } catch {}
    if ($userdata) { $userdata = "$userdata".Trim() }
    if (-not $userdata -or -not (Test-Path $userdata)) { $userdata = Join-Path $env:APPDATA 'spicetify' }
    $target = Join-Path $userdata "CustomApps\$app"

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('spotify-together-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Write-Host 'Descargando la ultima version...'
        # El zip es una foto completa del repositorio: nunca mezcla archivos de dos versiones
        $zip = Join-Path $tmp 'repo.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $tmp
        $source = Get-ChildItem -Path $tmp -Directory |
            ForEach-Object { Join-Path $_.FullName $app } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if (-not $source) { throw "la descarga no contiene la carpeta $app" }

        # Se reemplazan los archivos de la app; cualquier otro archivo de la carpeta se queda
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
        Write-Host "Copiado en $target" -ForegroundColor Green
    } catch {
        Write-Host "No se pudo descargar o copiar la app: $($_.Exception.Message)" -ForegroundColor Red
        return
    } finally {
        Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Si ya estaba activada, Spicetify solo avisa y no cambia nada
    & $spicetify config custom_apps $app
    Write-Host 'Aplicando con Spicetify. Spotify se va a reiniciar; si estabas en una sala, vuelves a entrar sola.' -ForegroundColor Yellow
    & $spicetify apply
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'spicetify apply fallo. Lee el mensaje de arriba; si Spotify se actualizo hace poco, suele arreglarse con: spicetify restore backup apply' -ForegroundColor Red
        return
    }
    Write-Host 'Listo. En Spotify aparece "Listen Together", con el icono de una nota musical.' -ForegroundColor Green
}
