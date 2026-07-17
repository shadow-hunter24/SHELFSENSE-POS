<?php
declare(strict_types=1);

require __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/auth.php';

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

require_authenticated();

$data = json_input();
$current = (string)($data['current_password'] ?? '');
$new = (string)($data['new_password'] ?? '');

if ($current === '' || $new === '') {
    http_response_code(400);
    echo json_encode(['error' => 'current_password and new_password are required']);
    exit;
}

$strengthError = validate_password_strength($new);
if ($strengthError !== null) {
    http_response_code(400);
    echo json_encode(['error' => $strengthError]);
    exit;
}

$pdo = get_pdo();
$stmt = $pdo->prepare('SELECT password_hash, COALESCE(must_change_password, 0) AS must_change_password FROM users WHERE id = ?');
$stmt->execute([get_session_user_id()]);
$user = $stmt->fetch();

if (!$user || !password_verify($current, $user['password_hash'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Current password is incorrect']);
    exit;
}

$hash = password_hash($new, PASSWORD_DEFAULT);
$upd = $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?');
$upd->execute([$hash, get_session_user_id()]);

echo json_encode(['ok' => true, 'message' => 'Password updated successfully']);
