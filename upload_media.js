require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function uploadMedia() {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    const data = new FormData();
    data.append('messaging_product', 'whatsapp');
    data.append('type', 'video/mp4');
    data.append('file', fs.createReadStream('./public/tpf_video_v2.mp4'));

    try {
        const response = await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/media`, data, {
            headers: {
                ...data.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });
        console.log('Media ID:', response.data.id);
    } catch (err) {
        console.error('Error uploading media:', err.response ? err.response.data : err.message);
    }
}

uploadMedia();
