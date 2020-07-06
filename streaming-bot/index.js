// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const path = require('path');

const dotenv = require('dotenv');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });

const restify = require('restify');
const corsMiddleware = require('restify-cors-middleware');
const bodyParser = require('body-parser');

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const { BotFrameworkAdapter } = require('botbuilder');

const generateDirectLineToken = require('./utils/generateDirectLineToken');
const renewDirectLineToken = require('./utils/renewDirectLineToken');

// This bot's main dialog.
const { EchoBot } = require('./bot');

const cors = corsMiddleware({ 
    origins: ['*'] 
  }); 
  

// Create HTTP server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${ server.name } listening to ${ server.url }`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about how bots work.
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Set the onTurnError for the singleton BotFrameworkAdapter.
adapter.onTurnError = onTurnErrorHandler;

// Create the main dialog.
const myBot = new EchoBot();

// Listen for incoming requests.
server.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        // Route to main dialog.
        await myBot.run(context);
    });
});

adapter.useNamedPipe(async (context) => {
    await myBot.run(context);
    },
    'ash-streaming-bot.directline'
);

// Listen for Upgrade requests for Streaming.
server.on('upgrade', (req, socket, head) => {
    // Create an adapter scoped to this WebSocket connection to allow storing session data.
    const streamingAdapter = new BotFrameworkAdapter({
        appId: process.env.MicrosoftAppId,
        appPassword: process.env.MicrosoftAppPassword
    });
    // Set onTurnError for the BotFrameworkAdapter created for each connection.
    streamingAdapter.onTurnError = onTurnErrorHandler;

    streamingAdapter.useWebSocket(req, socket, head, async (context) => {
        // After connecting via WebSocket, run this logic for every request sent over
        // the WebSocket connection.
        await myBot.run(context);
    });
});

server.post('/directline/token', (req, res) => {
    console.log('/directline/token');
    const options = {
        method: 'POST',
        uri: 'https://ash-streaming-js.azurewebsites.net/.bot/v3/directline/tokens/generate',
        headers: {
            'Authorization': `Bearer ${process.env.DIRECT_LINE_SECRET}`,
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
            user: { id: 'dl_userId123' },
            trustedOrigins: [
              'https://webchat-mockbot2.azurewebsites.net/',
              'http://localhost:3000',
              'https://ash-streaming-js.azurewebsites.net/',
              'http://localhost',
              'http://localhost:3978'
            ]
        })
    }

    request.post(options, (error, response, body) => {
        if (!error && response.statusCode < 300) { 
            res.send({ 
                token: body.token 
            }); 
        } else { 
        res.status(500).send('Call to retrieve token from DirectLine failed'); 
        } 
    });
});

server.post('/api/token/directlinease', async (req, res) => {
    console.log('/api/token/directlinease');
    const { DIRECT_LINE_SECRET, WEBSITE_HOSTNAME } = process.env;

    try {
        if (!WEBSITE_HOSTNAME) {
            return res.send(500, 'only available on azure', { 'Access-Control-Allow-Origin': '*' });
        }

        const { token } = req.query;

        try {
            const result = await (token
                ? renewDirectLineToken(token, { domain: `https://${WEBSITE_HOSTNAME}/.bot/` })
                : generateDirectLineToken(DIRECT_LINE_SECRET, { domain: `https://${WEBSITE_HOSTNAME}/.bot/` }));

            res.sendRaw(JSON.stringify(result, null, 2), {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            });
        } catch (err) {
            res.send(500, err.message);
        }

        if (token) {
            console.log(`Refreshing Direct Line token`);
        } else {
            console.log(
                `Requesting Direct Line token using secret "${DIRECT_LINE_SECRET.substr(
                0,
                3
                )}...${DIRECT_LINE_SECRET.substr(-3)}"`
            );
        }
    } catch (err) {
        res.send(500, { message: err.message, stack: err.stack }, { 'Access-Control-Allow-Origin': '*' });
    }
});
