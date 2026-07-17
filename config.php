<?php
// Local development defaults; do not commit real production secrets.
// Desktop (Electron) overrides via environment:
//   STOCKTRACKER_DB_PATH   — SQLite file (userData in packaged app)
//   STOCKTRACKER_DATA_DIR  — writable folder for rate limits, etc.
//   DESKTOP_APP=1          — enables longer POS session timeout
$DB_CONFIG = [
    // Switch driver to 'sqlite' for a standalone desktop app
    'driver' => 'sqlite',
    // Allow Electron to override DB path via environment for writable userData dir
    'sqlite_path' => getenv('STOCKTRACKER_DB_PATH') ?: (__DIR__ . '/data/stocktracker.sqlite'),

    // MySQL settings kept for backward compatibility (unused when driver=sqlite)
    'host' => '127.0.0.1',
    'name' => 'stocktracker',
    'user' => 'root',
    'pass' => '',
    'charset' => 'utf8mb4',
];