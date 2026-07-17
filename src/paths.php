<?php
declare(strict_types=1);

/** Writable app data directory (DB sidecars, rate limits, etc.). */
function get_writable_data_dir(): string
{
    $envDir = getenv('STOCKTRACKER_DATA_DIR');
    if (is_string($envDir) && $envDir !== '') {
        if (!is_dir($envDir)) {
            mkdir($envDir, 0777, true);
        }
        return $envDir;
    }

    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    return $dir;
}

function is_desktop_app(): bool
{
    return getenv('DESKTOP_APP') === '1';
}
