<?php
declare(strict_types=1);

require __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/auth.php';
require_once __DIR__ . '/../src/rate_limit.php';
require_once __DIR__ . '/../src/csrf.php';

header('Content-Type: application/json');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    $lockout = check_login_rate_limit();
    if ($lockout !== null) {
        http_response_code(429);
        echo json_encode([
            'error' => 'too_many_attempts',
            'message' => 'Too many failed login attempts. Please try again later.',
            'retry_after' => $lockout['retry_after'],
        ]);
        exit;
    }

    $data = json_input();
    $username = trim((string)($data['username'] ?? ''));
    $password = (string)($data['password'] ?? '');
    if ($username === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['error' => 'username and password required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare('SELECT id, username, password_hash, role, status, COALESCE(must_change_password, 0) AS must_change_password FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $u = $stmt->fetch();
    } catch (PDOException $e) {
        error_log('Login query fallback: ' . $e->getMessage());
        $stmt = $pdo->prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $u = $stmt->fetch();
        if ($u) {
            $u['status'] = 'active';
            $u['must_change_password'] = 0;
        }
    }

    if (!$u || !password_verify($password, $u['password_hash'])) {
        record_login_failure();
        http_response_code(401);
        echo json_encode(['error' => 'invalid credentials']);
        exit;
    }

    // Check account status AFTER verifying the password.
    // We return the same 401 (not 403) so an attacker cannot enumerate
    // which usernames exist but are deactivated vs which simply don't exist.
    if (($u['status'] ?? 'active') !== 'active') {
        record_login_failure();
        http_response_code(401);
        echo json_encode(['error' => 'invalid credentials']);
        exit;
    }

    clear_login_attempts();
    start_secure_session();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$u['id'];
    $_SESSION['username'] = $u['username'];
    $_SESSION['role'] = $u['role'];
    $_SESSION['last_activity'] = time();

    // Generate a fresh CSRF token bound to this new session
    $csrfToken = regenerate_csrf_token();

    echo json_encode([
        'ok' => true,
        'role' => $u['role'],
        'must_change_password' => (int)($u['must_change_password'] ?? 0) === 1,
        'csrf_token' => $csrfToken,
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
