<?php
declare(strict_types=1);

require_once __DIR__ . '/session.php';

const MIN_PASSWORD_LENGTH = 8;

function require_authenticated(): void
{
    start_secure_session();

    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'unauthenticated', 'reason' => 'not_logged_in']);
        exit;
    }

    $now = time();
    if (isset($_SESSION['last_activity']) && ($now - (int)$_SESSION['last_activity']) > get_session_timeout_seconds()) {
        destroy_session();
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'unauthenticated', 'reason' => 'session_expired']);
        exit;
    }

    $_SESSION['last_activity'] = $now;
}

function require_admin(): void
{
    require_authenticated();
    if (($_SESSION['role'] ?? '') !== 'admin') {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'forbidden']);
        exit;
    }
}

function is_admin(): bool
{
    return ($_SESSION['role'] ?? '') === 'admin';
}

function get_session_user_id(): int
{
    return (int)$_SESSION['user_id'];
}

function get_session_role(): string
{
    return (string)($_SESSION['role'] ?? 'user');
}

function validate_password_strength(string $password): ?string
{
    if (strlen($password) < MIN_PASSWORD_LENGTH) {
        return 'Password must be at least ' . MIN_PASSWORD_LENGTH . ' characters';
    }
    return null;
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
