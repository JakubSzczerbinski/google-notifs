const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const gqlclient = require('graphql-client')({url : "http://localhost:4000/graphql"})

// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = 'credentials.json';
const { notif_synchronizer } = require("./notif_synchronizer.js");
console.log()

// Load client secrets from a local file.
fs.readFile('client_secret.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Sheets API.
  authorize(JSON.parse(content), syncNotif);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return callback(err);
      oAuth2Client.setCredentials(token)
 ;     // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
} 

function getHeader(msg, headerName)
{
  const headers = msg.payload.headers;
  let result = "";
  headers.map((header) => {
    if (header.name == headerName)
      result = header.value;
  });
  return result;
}

function syncGmail(auth)
{
  const sync = notif_synchronizer("gmail", gqlclient);
  const gmail = google.gmail({version: 'v1', auth});

  function getGmailNotifs()
  {
    console.log("Checking gmail inbox");

    return gmail.users.messages.list({
      userId: 'me',
      q: 'is:inbox AND is:unread AND (is:sent OR category:updates OR category:personal)'
    })
    .then((res) => {
      // if (err) return console.log(err);
      const messages = res.data.messages;
      // console.log(messages);
      if (!messages){
        console.log("Inbox empty");
        return [];
      }
      return Promise.all(messages.map((message, i) => {
        let msg_id = message.id;
        return gmail.users.messages.get(
          {
            userId: 'me',
            id: msg_id,
            format: 'full'
          })
        .then((res) => {
          const msg = res.data;
          return {
            title: "Gmail: " + getHeader(msg, "From").split("<")[0],
            subtitle: getHeader(msg, "Subject"),
            id: msg.id
          }
        })
        .catch((err) => {
          console.log("Request for id " + msg_id + " failed. Error:");
          console.log(err);
          return {};
        })
      }));
    })
    .catch((err) => {
      console.log("Request for gmail messages failed. Error: " + err.messages)    
      return [];
    })
  }

  getGmailNotifs()
  .then((notifs) => {
    sync(notifs);
  })
  .catch((err) => {
    console.log(err.messages);
  })
}

function syncCalendar(auth) {
 const calendar = google.calendar({version: 'v3', auth});
  calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const events = res.data.items;
    if (events.length) {
      console.log('Upcoming 10 events:');
      events.map((event, i) => {
        // const start = event.start.dateTime || event.start.date;
        console.log(event);
        // console.log(`${start} - ${event.summary}`);
      });
    } else {
      console.log('No upcoming events found.');
    }
  });
}

function syncNotif(auth) {
  syncGmail(auth);
  setInterval(syncGmail, 10000, auth);

  // syncCalendar(auth);
  // setInterval(syncCalendar, 100000, auth);
}
