const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const gqlclient = require('graphql-client')({url : "http://192.168.1.109:4000/graphql"})

// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = 'credentials.json';

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
  const gmail = google.gmail({version: 'v1', auth});
  gqlclient.query(
    `
      query {
        allValidNotifs {
          id
          data
        }
      }
    `, {})
  .then(function(body) {
    const notifs = body.data.allValidNotifs;
    removeNotifs(notifs);
    addNotifs(notifs);
  })
  .catch(function(err) {
    console.log(err.message)
  })

  function addNotifs(notifs)
  {
    console.log("Chcecking gmail inbox");

    gmail.users.messages.list({
      userId: 'me',
      q: 'is:inbox AND is:unread AND (is:sent OR category:updates)'
    }, (err, res) => {
      if (err) return console.log('The API returned an error: ' + err);
      const messages = res.data.messages;
      if (!messages)
        return console.log("Inbox empty");
      messages.map((message, i) => {
        let msg_id = message.id;
        gmail.users.messages.get(
        {
          userId: 'me',
          id: msg_id,
          format: 'full'
        }, (err, res) => {
          const msg = res.data;
          const gmail_id = msg.id;
          let has_notif = false;
          notifs.map((notif, err) => {
            try {
              const data = JSON.parse(notif.data);
              if (data && data.gmail_id && data.gmail_id === gmail_id)
                has_notif = true;
            }
            catch (e) {}
          });
          if (!has_notif)
          {
            gqlclient.query(
              `
                mutation addGmailNotif($title : String!, $subtitle: String!, $data : String!, $source : String!) {
                  addNotif(data: $data, valid: true, title: $title, subtitle: $subtitle, source: $source)
                  {
                    data
                    id
                  }
                }
              `, {
                title: "Gmail: " + getHeader(msg, "From").split("<")[0],
                subtitle : getHeader(msg, "Subject"),
                data : JSON.stringify({gmail_id : gmail_id}),
                source: 'gmail'
              }, () => { console.log ("added notif")}
            )
            .then ((body) => {
              console.log(body);
            })
            .catch((err) => {
              console.log(err.message);
            });
          }
        });
      });
    });
  }

  function removeNotifs(notifs)
  {
    notifs.map((notif, err) => {
      try {
        try {
            JSON.parse(notif.data);
        } catch (e) {
            return;
        }
        const data = JSON.parse(notif.data);
        if (data && data.gmail_id)
        { 
          gmail.users.messages.get(
          {
            userId: 'me',
            id: data.gmail_id,
            format: 'full'
          }, (err, res) => {
            if (err) return console.log("Failed to fetch");
            const labels = res.data.labelIds;
            let is_unread = false;
            labels.map((label, i) => {
              if (label == "UNREAD")
                is_unread = true;
            });
            if (!is_unread)
            {
              gqlclient.query(
                `
                  mutation removeGmailNotif($id : Int!) {
                    invalidateNotif(id : $id)
                    {
                      data
                      id
                    }
                  }
                `, {
                  id: notif.id
                }, () => { console.log ("removed notif")}
              )
              .then ((body) => {
                console.log(body);
              })
              .catch((err) => {
                console.log(err.message);
              });
            }
          });
        }
      }
      catch (e) {
        console.log(e);
      }
    });
  }
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

  syncCalendar(auth);
  // setInterval(syncCalendar, 100000, auth);
}
