$token = "EAAdqDZBDMsLABSOr0uKMc0xTxn1KAGDZCoqgbGAgkiIpDaDfBIa7qXtGIJxTfLuzdUScaLRMskZCfq1LrKgrilDVlOaFrAO0TVgKhLrpAAi7ZBPvMQd1hrrg8W6AZAC6AfuOxgQwA1Jyi4x3diRGGpQzEZBjMsBbTUA0iLgiIFrRr8TcKxv1vkcMWxKGbi3QZDZD"
$phoneId = "1165447209994569"
$body = @{ pin = "902466" } | ConvertTo-Json
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}
$response = Invoke-RestMethod -Uri "https://graph.facebook.com/v20.0/$phoneId" -Method POST -Headers $headers -Body $body
$response | ConvertTo-Json
