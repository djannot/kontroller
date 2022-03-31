#!/usr/bin/env node

const process = require('process')
process.on('SIGINT', () => {
  console.info("Interrupted")
  process.exit(0)
})

const fs = require('fs');
const express = require('express');

let app = express();
let bodyParser = require('body-parser');

app.use(express.static('public'))

app.use(bodyParser.json());

/*
app.get('/', function(req, res) {

  console.log('Get index');
  fs.createReadStream('./index.html')
  .pipe(res);
});
*/

const WebSocketServer = require('ws').Server;
const server = require('http').createServer();

let wss = new WebSocketServer({

    server: server
  });
const k8s = require('@kubernetes/client-node');
const request = require('request');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const opts = {};
kc.applyToRequest(opts);

const watch = new k8s.Watch(kc);

function run(ws, path, resourceVersion, first) {
    //console.log(`run(${path}, ${resourceVersion})`);
    watch.watch(path,
        // optional query parameters can go here.
        {
            allowWatchBookmarks: true,
            resourceVersion: resourceVersion
        },
        // callback is called for each received object.
        (type, apiObj, watchObj) => {
            //if(first == false) {
                ws.send(JSON.stringify({ts: Date.now(), type: type, apiObj: apiObj}));
            //}
            // tslint:disable-next-line:no-console
            //console.log(JSON.stringify(apiObj, null, 4));
            resourceVersion = apiObj.metadata.resourceVersion;
        },
        // done callback is called if the watch terminates normally
        (err) => {
            // tslint:disable-next-line:no-console
            console.log("ERROR for path: " + path, err);
        })
    .then((req) => {
        // watch returns a request object which you can use to abort the watch.
        setTimeout(() => { run(path, resourceVersion); }, 10 * 1000, false);
    });   
}

function req(ws, path) {
    request.get(`${kc.getCurrentCluster().server}` + path, opts,
    (error, response, body) => {
    if (error) {
            console.log(`error: ${error}`);
            process.exit();
        }
        try {
            json = JSON.parse(body);
            if(json && json.resources) {
                json.resources.forEach(resource => {
                    if(resource.verbs.includes('watch')){
                        run(ws, path + '/' + resource.name, '', true);
                    }
                });
            }
        } catch {}
    });
}

server.on('request', app);

wss.on('connection', function connection(ws) {
    ws.on('message', function message(data) {
      console.log('received: %s', data);
    });

    request.get(`${kc.getCurrentCluster().server}`, opts,
    (error, response, body) => {
        if (error) {
            console.log(`error: ${error}`);
            process.exit();
        }
        JSON.parse(body).paths.forEach(path => {
            req(ws, path);
        });
    });
});

server.listen(process.env.PORT, function() {
    console.log(`http/ws server listening on ${process.env.PORT}`);
});