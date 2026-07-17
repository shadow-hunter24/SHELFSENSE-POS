<?php
declare(strict_types=1);

require_once __DIR__ . '/paths.php';

/** Default idle session lifetime for browser/dev use (30 minutes). */
const SESSION_TIMEOUT_WEB_SECONDS = 1800;

/** Default idle session lifetime for desktop POS shifts (8 hours). */
const SESSION_TIMEOUT_DESKTOP_SECONDS = 28800;

function get_session_timeout_seconds(): int
{
    if (is_desktop_app()) {
        $custom = (int)(getenv('DESKTOP_SESSION_TIMEOUT') ?: SESSION_TIMEOUT_DESKTOP_SECONDS);
        return max(SESSION_TIMEOUT_WEB_SECONDS, $custom);
    }
    return SESSION_TIMEOUT_WEB_SECONDS;
}

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => false,
    ]);
    session_start();
}

function refresh_session_activity(): bool
{
    start_secure_session();

    $now = time();
    $timeout = get_session_timeout_seconds();
    if (isset($_SESSION['last_activity'])) {
        $idle = $now - (int)$_SESSION['last_activity'];
        if ($idle > $timeout) {
            destroy_session();
            return false;
        }
    }

    $_SESSION['last_activity'] = $now;
    return isset($_SESSION['user_id']);
}

function destroy_session(): void
{
    start_secure_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }
    session_destroy();
}
