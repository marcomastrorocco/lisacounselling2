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
$enquiryType = trim((string) ($_POST['enquiry_type'] ?? ''));
$planManagement = trim((string) ($_POST['plan_management'] ?? ''));
$enquiryFor = trim((string) ($_POST['enquiry_for'] ?? ''));
$contactPreference = trim((string) ($_POST['contact_preference'] ?? ''));

if ($name === '' || $email === false || $message === '') {
    header('Location: /contact/?error=1');
    exit;
}

// Prevent mail-header injection and keep submissions to sensible lengths.
$name = str_replace(["\r", "\n"], ' ', mb_substr($name, 0, 120));
$phone = str_replace(["\r", "\n"], ' ', mb_substr($phone, 0, 60));
$message = mb_substr($message, 0, 5000);
$enquiryType = str_replace(["\r", "\n"], ' ', mb_substr($enquiryType, 0, 80));
$planManagement = str_replace(["\r", "\n"], ' ', mb_substr($planManagement, 0, 80));
$enquiryFor = str_replace(["\r", "\n"], ' ', mb_substr($enquiryFor, 0, 80));
$contactPreference = str_replace(["\r", "\n"], ' ', mb_substr($contactPreference, 0, 80));

$recipient = 'info@spescounselling.com.au';
$isNdis = $enquiryType === 'NDIS counselling enquiry';
$subject = $isNdis ? 'New SPES Counselling NDIS enquiry' : 'New SPES Counselling website enquiry';
$body = "Name: {$name}\nEmail: {$email}\nPhone: {$phone}\n";
if ($isNdis) $body .= "Enquiry for: {$enquiryFor}\nPlan management: {$planManagement}\nPreferred contact: {$contactPreference}\n";
$body .= "\nMessage:\n{$message}\n";
$headers = [
    'From: SPES Counselling Website <info@spescounselling.com.au>',
    "Reply-To: {$email}",
    'Content-Type: text/plain; charset=UTF-8',
];

$sent = mail($recipient, $subject, $body, implode("\r\n", $headers));
header('Location: ' . ($isNdis ? '/ndis-counselling/' : '/contact/') . ($sent ? '?sent=1' : '?error=1'));
exit;
