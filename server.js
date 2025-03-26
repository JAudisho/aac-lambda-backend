const express = require('express');
const cors = require('cors');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url} from ${req.ip}`);
    next();
});

const REGION = 'us-east-2';
const BUCKET_NAME = 'aac-tts-audio';

const polly = new PollyClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

app.get('/api/test', (req, res) => {
    res.json({ message: "Server is running" });
});

app.post('/api/synthesize', async (req, res) => {
    try {
        const text = req.body.text;
        if (!text) {
            return res.status(400).json({ error: "Text input is required." });
        }

        console.log("Sending request to Polly...");

        const pollyParams = {
            Text: text,
            OutputFormat: "mp3",
            VoiceId: "Ivy",
            Engine: "standard"
        };

        console.log("Polly input:", pollyParams);

        let response;
        try {
            response = await polly.send(new SynthesizeSpeechCommand(pollyParams));
            console.log("Polly output:", response);
        } catch (err) {
            console.error("Polly Error:", err);
            return res.status(500).json({ error: "Polly failed", details: err.message });
        }

        const { AudioStream } = response;
        if (!AudioStream) {
            console.error("Polly returned an empty AudioStream.");
            return res.status(500).json({ error: "Polly did not return audio." });
        }

        const fileName = `tts-${uuidv4()}.mp3`;
        const filePath = path.join(__dirname, fileName);

        console.log(`Saving audio file to ${filePath}`);
        const fileStream = fs.createWriteStream(filePath);
        fileStream.write(Buffer.from(await AudioStream.transformToByteArray()));
        fileStream.end();

        fileStream.on('finish', async () => {
            const s3Params = {
                Bucket: BUCKET_NAME,
                Key: fileName,
                Body: fs.createReadStream(filePath),
                ContentType: "audio/mpeg"
            };

            console.log("Uploading to S3...");
            try {
                await s3.send(new PutObjectCommand(s3Params));
                console.log("Upload successful!");
            } catch (err) {
                console.error("S3 Upload Error:", err);
                return res.status(500).json({ error: "S3 Upload Failed", details: err.message });
            }

            const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
            console.log('Audio uploaded:', s3Url);

            res.json({ url: s3Url });

            fs.unlinkSync(filePath);
        });
    } catch (err) {
        console.error("Error generating speech:", err);
        res.status(500).json({ error: "Failed to generate speech.", details: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
});