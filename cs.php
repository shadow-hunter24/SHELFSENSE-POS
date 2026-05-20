<?php
require "config.php";
$pdo = new PDO("sqlite:" . $DB_CONFIG["sqlite_path"], null, null, [PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$total = $pdo->query("SELECT COUNT(*) FROM products WHERE id != 0 AND sku != 'DELETED'")->fetchColumn();
file_put_contents("php://stdout", "Total: $total\n");
$rows = $pdo->query("SELECT p.id, p.name, COALESCE(s.quantity,0) as qty FROM products p LEFT JOIN stock s ON s.product_id = p.id WHERE p.id != 0 AND p.sku != 'DELETED' ORDER BY p.id DESC LIMIT 200")->fetchAll();
$i = 0;
foreach ($rows as $r) {
    $i++;
    if ((int)$r['qty'] === 0) {
        file_put_contents("php://stdout", "row=$i page=" . ceil($i/100) . " id={$r['id']} {$r['name']}\n");
    }
}
