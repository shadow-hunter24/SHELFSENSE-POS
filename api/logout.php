<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/session.php';
require_once __DIR__ . '/../src/security_headers.php';
require_once __DIR__ . '/../src/csrf.php';

header('Content-Type: application/json');
send_security_headers();
verify_csrf_token();
destroy_session();
echo json_encode(['ok' => true]);
