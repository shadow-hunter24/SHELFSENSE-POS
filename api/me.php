<?php
declare(strict_types=1);

require __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/auth.php';

header('Content-Type: application/json');

start_secure_session();

if (!refresh_session_activity() || !isset($_SESSION['user_id'])) {
    echo json_encode(['authenticated' => false, 'reason' => 'session_expired']);
    exit;
}

$pdo = get_pdo();

try {
    $stmt = $pdo->prepare('SELECT id, username, role, status, COALESCE(must_change_password, 0) AS must_change_password FROM users WHERE id = ?');
    $stmt->execute([(int)$_SESSION['user_id']]);
    $user = $stmt->fetch();
} catch (PDOException $e) {
    error_log('me.php fallback query: ' . $e->getMessage());
    $stmt = $pdo->prepare('SELECT id, username, role FROM users WHERE id = ?');
    $stmt->execute([(int)$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if ($user) {
        $user['status'] = 'active';
        $user['must_change_password'] = 0;
    }
}

if (!$user || ($user['status'] ?? 'active') !== 'active') {
    destroy_session();
    echo json_encode(['authenticated' => false, 'reason' => 'account_deactivated']);
    exit;
}

echo json_encode([
    'authenticated' => true,
    'user_id' => (int)$user['id'],
    'username' => $user['username'],
    'role' => $user['role'],
    'must_change_password' => (int)($user['must_change_password'] ?? 0) === 1,
    'session_timeout_seconds' => get_session_timeout_seconds(),
    'desktop_app' => is_desktop_app(),
]);
