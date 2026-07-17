<?php
declare(strict_types=1);

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 900;

require_once __DIR__ . '/paths.php';

function login_rate_limit_file(): string
{
    return get_writable_data_dir() . '/login_attempts.json';
}

function get_client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
}

function read_login_attempts(): array
{
    $path = login_rate_limit_file();
    if (!file_exists($path)) {
        return [];
    }
    $data = json_decode((string)file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function write_login_attempts(array $data): void
{
    file_put_contents(login_rate_limit_file(), json_encode($data), LOCK_EX);
}

function check_login_rate_limit(): ?array
{
    $ip = get_client_ip();
    $data = read_login_attempts();
    $entry = $data[$ip] ?? ['attempts' => [], 'locked_until' => 0];
    $now = time();

    if (($entry['locked_until'] ?? 0) > $now) {
        return [
            'locked_until' => (int)$entry['locked_until'],
            'retry_after' => (int)$entry['locked_until'] - $now,
        ];
    }

    $entry['attempts'] = array_values(array_filter(
        $entry['attempts'] ?? [],
        static fn(int $ts): bool => ($now - $ts) < LOGIN_LOCKOUT_SECONDS
    ));

    if (count($entry['attempts']) >= LOGIN_MAX_ATTEMPTS) {
        $entry['locked_until'] = $now + LOGIN_LOCKOUT_SECONDS;
        $data[$ip] = $entry;
        write_login_attempts($data);
        return [
            'locked_until' => $entry['locked_until'],
            'retry_after' => LOGIN_LOCKOUT_SECONDS,
        ];
    }

    $data[$ip] = $entry;
    write_login_attempts($data);
    return null;
}

function record_login_failure(): void
{
    $ip = get_client_ip();
    $data = read_login_attempts();
    $entry = $data[$ip] ?? ['attempts' => [], 'locked_until' => 0];
    $entry['attempts'][] = time();
    $data[$ip] = $entry;
    write_login_attempts($data);
}

function clear_login_attempts(): void
{
    $ip = get_client_ip();
    $data = read_login_attempts();
    unset($data[$ip]);
    write_login_attempts($data);
}
