const axios = require('axios');
const token = 'EAAdqDZBDMsLABSOr0uKMc0xTxn1KAGDZCoqgbGAgkiIpDaDfBIa7qXtGIJxTfLuzdUScaLRMskZCfq1LrKgrilDVlOaFrAO0TVgKhLrpAAi7ZBPvMQd1hrrg8W6AZAC6AfuOxgQwA1Jyi4x3diRGGpQzEZBjMsBbTUA0iLgiIFrRr8TcKxv1vkcMWxKGbi3QZDZD';
const phoneNumberId = '1165447209994569';

const payload = {
    messaging_product: 'whatsapp',
    to: '919024668671',
    type: 'template',
    template: {
        name: 'kyc_folloup',
        language: { code: 'en' },
        components: [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: 'Client' }
                ]
            }
        ]
    }
};

axios.post('https://graph.facebook.com/v21.0/' + phoneNumberId + '/messages', payload, {
    headers: { Authorization: 'Bearer ' + token }
}).then(res => console.log(res.data)).catch(err => console.log(JSON.stringify(err.response.data, null, 2)));
