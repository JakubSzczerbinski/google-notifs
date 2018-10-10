
exports.notif_synchronizer = function (source_, gqlclient_)
{
  const gqlclient = gqlclient_;
  const source = source_;
  const add_notif = function(notif)
  {
    let data = notif.data;
    if (!data) {
      data = {};
    } 
    gqlclient.query(
      `
        mutation addNotif($title : String!, $subtitle: String!, $data : String!, $source : String!) {
          addNotif(data: $data, valid: true, title: $title, subtitle: $subtitle, source: $source)
          {
            data
            id
          }
        }
      `, {
        title: notif.title,
        subtitle : notif.subtitle,
        data : JSON.stringify({id : notif.id, data : notif.data }),
        source: source
      }, () => { console.log ("added notif")}
    )
    .then ((body) => {
      console.log(body);
    })
    .catch((err) => {
      console.log(err.message);
    });
  }
  const invalidate_notif = function (id)
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
        id: id
      }, () => { console.log ("removed notif")}
    )
    .then ((body) => {
      console.log(body);
    })
    .catch((err) => {
      console.log(err.message);
    });
  }
  const sync_notifs = function (notifs)
  {
    console.log("Syncing " + source + " notifs with api");
    gqlclient.query(
      `
        query {
          allValidNotifs {
            id
            data
            source
          }
        }
      `, {})
    .then(function(body) {
      const notifsFromApi = body.data.allValidNotifs;
      for (let i = 0; i < notifsFromApi.length; i++)
      {
        const notifFromApi = notifsFromApi[i];
        const data = JSON.parse(notifFromApi.data);
        let isInCurrentNotifs = false;
        for (let j = 0; j < notifs.length; j++)
        {
          const notif = notifs[j];
          if (notif.id == data.id)
          {
            isInCurrentNotifs = true;
          }
        }
        if (!isInCurrentNotifs && notifFromApi.source == source)
          invalidate_notif(notifFromApi.id);
      }

      for (let i = 0; i < notifs.length; i++)
      {
        const notif = notifs[i];
        let isInApi = false;
        for (let j = 0; j < notifsFromApi.length; j++)
        {
          const notifFromApi = notifsFromApi[j];
          const data = JSON.parse(notifFromApi.data);
          if (notifFromApi.source == source && data.id == notif.id)
          {
            isInApi = true;
          }
        }
        if (!isInApi)
        {
          add_notif(notif);
        }
      }
    })
    .catch(function(err) {
      console.log(err.message)
    })
  }
  return sync_notifs;
}