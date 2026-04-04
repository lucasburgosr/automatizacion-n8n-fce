param(
    [string]$PgRoot = "C:\Program Files\PostgreSQL\17",
    [string]$BuildRoot = ".build\pgvector-v0.8.1",
    [string]$Database = "",
    [string]$Username = "postgres",
    [switch]$CreateExtension
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    throw "Ejecutá este script en una consola de PowerShell abierta como Administrador."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot $BuildRoot
$vectorDll = Join-Path $sourceRoot "vector.dll"
$vectorControl = Join-Path $sourceRoot "vector.control"
$vectorSqlDir = Join-Path $sourceRoot "sql"

if (-not (Test-Path $vectorDll)) {
    throw "No existe $vectorDll. La compilación de pgvector no está disponible."
}

if (-not (Test-Path $vectorControl)) {
    throw "No existe $vectorControl."
}

$libTarget = Join-Path $PgRoot "lib"
$extensionTarget = Join-Path $PgRoot "share\extension"

Copy-Item -Force $vectorDll (Join-Path $libTarget "vector.dll")
Copy-Item -Force $vectorControl (Join-Path $extensionTarget "vector.control")
Copy-Item -Force (Join-Path $vectorSqlDir "vector*.sql") $extensionTarget

Write-Host "Archivos de pgvector copiados a PostgreSQL en $PgRoot"

if ($CreateExtension) {
    if (-not $Database) {
        throw "Si usás -CreateExtension, también tenés que pasar -Database."
    }

    $psql = Join-Path $PgRoot "bin\psql.exe"
    if (-not (Test-Path $psql)) {
        throw "No existe $psql"
    }

    & $psql -U $Username -d $Database -c "CREATE EXTENSION IF NOT EXISTS vector;"
}
