<?php
declare(strict_types=1);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method not allowed');
}

// Honeypot: genuine visitors never see or complete this field.
if (!empty($_POST['website'] ?? '')) {
    header('Location: /contact/?sent=1');
    exit;
}

$name = trim((string) ($_POST['name'] ?? ''));
$email = filter_var(trim((string) ($_POST['email'] ?? '')), FILTER_VALIDATE_EMAIL);
$phone = trim((string) ($_POST['phone'] ?? ''));
$message = trim((string) ($_POST['message'] ?? ''));

if ($name === '' || $email === false || $message === '') {
    header('Location: /contact/?error=1');
    exit;
}

// Prevent mail-header injection and keep submissions to sensible lengths.
$name = str_replace(["\r", "\n"], ' ', mb_substr($name, 0, 120));
$phone = str_replace(["\r", "\n"], ' ', mb_substr($phone, 0, 60));
$message = mb_substr($message, 0, 5000);

$recipient = 'info@spescounselling.com.au';
$subject = 'New SPES Counselling website enquiry';
$body = "Name: {$name}\nEmail: {$email}\nPhone: {$phone}\n\nMessage:\n{$message}\n";
$headers = [
    'From: SPES Counselling Website <info@spescounselling.com.au>',
    "Reply-To: {$email}",
    'Content-Type: text/plain; charset=UTF-8',
];

$sent = mail($recipient, $subject, $body, implode("\r\n", $headers));
header('Location: /contact/?' . ($sent ? 'sent=1' : 'error=1'));
exit;
