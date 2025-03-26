const express = require('express');
const bodyParser = require('body-parser');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware');

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Express setup
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(awsServerlessExpressMiddleware.eventContext());

// AWS ENV setup
const REGION = process.env.REGION || 'us-east-2';
const BUCKET_NAME = process.env.HOSTING_S3ANDCLOUDFRONT_HOSTINGBUCKETNAME;

const polly = new PollyClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// Logging
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// Health check
app.get('/api/test', (req, res) => {
  res.json({ message: 'Lambda backend is live' });
});

// Main TTS route
app.post('/api/synthesize', async (req, res) => {
  try {
    const text = req.body.text;
    if (!text) {
      return res.status(400).json({ error: 'Text input is required.' });
    }

    const pollyParams = {
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: 'Ivy',
      Engine: 'standard'
    };

    const response = await polly.send(new SynthesizeSpeechCommand(pollyParams));
    const { AudioStream } = response;

    if (!AudioStream) {
      return res.status(500).json({ error: 'Polly did not return audio.' });
    }

    const fileName = `tts-${uuidv4()}.mp3`;
    const filePath = path.join('/tmp', fileName); // Lambda allows only /tmp for temp files

    const fileStream = fs.createWriteStream(filePath);
    fileStream.write(Buffer.from(await AudioStream.transformToByteArray()));
    fileStream.end();

    fileStream.on('finish', async () => {
      const s3Params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fs.createReadStream(filePath),
        ContentType: 'audio/mpeg'
      };

      await s3.send(new PutObjectCommand(s3Params));

      const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
      res.json({ url: s3Url });

      fs.unlinkSync(filePath);
    });
  } catch (err) {
    console.error('Error generating speech:', err);
    res.status(500).json({ error: 'Failed to generate speech.', details: err.message });
  }
});

app.listen(3000, () => {
  console.log('App started');
});

module.exports = app;
