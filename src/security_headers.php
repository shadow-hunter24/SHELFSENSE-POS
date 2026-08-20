<?php
declare(strict_types=1);

/**
 * Emit security-hardening HTTP response headers.
 *
 * Called at the top of every API file (and index.php) before any output.
 *
 * Headers applied:
 *  - X-Content-Type-Options      : Prevent MIME-sniffing attacks
 *  - X-Frame-Options             : Prevent clickjacking (deny framing)
 *  - Referrer-Policy             : Don't leak URL in Referer header
 *  - Cache-Control               : Never cache API responses
 *  - Content-Security-Policy     : Restricted policy for API endpoints
 *                                  (no HTML content — just JSON)
 *
 * NOTE: X-XSS-Protection is intentionally omitted — it is deprecated
 * and can introduce vulnerabilities in old IE. Modern browsers rely on CSP.
 */
function send_security_headers(): void
{
    // Prevent browsers from guessing content types
    header('X-Content-Type-Options: nosniff');

    // Deny all framing — prevents clickjacking of the app in an iframe
    header('X-Frame-Options: DENY');

    // Don't send the Referer header when navigating away
    header('Referrer-Policy: strict-origin-when-cross-origin');

    // API responses must never be cached by proxies or browsers
    header('Cache-Control: no-store, no-cache, must-revalidate, private');
    header('Pragma: no-cache');

    // Tight CSP for JSON API endpoints — no script/style needed
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
}
