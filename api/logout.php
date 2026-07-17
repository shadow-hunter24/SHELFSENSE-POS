<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/session.php';

header('Content-Type: application/json');
destroy_session();
echo json_encode(['ok' => true]);
