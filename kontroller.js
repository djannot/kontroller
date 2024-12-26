#!/usr/bin/env node

const process = require('process');
process.on('SIGINT', () => {
  console.info('Interrupted');
  process.exit(0);
});

const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

const { Watch, KubeConfig } = require('@kubernetes/client-node');
const request = require('request');

let app = express();
app.use(express.static('public'));
app.use(bodyParser.json());

const server = require('http').createServer(app);
const WebSocketServer = require('ws').Server;
let wss = new WebSocketServer({ server: server });

const kc = new KubeConfig();
kc.loadFromDefault();
const opts = {};
kc.applyToRequest(opts);

const watch = new Watch(kc);

// Store watch requests by WebSocket connection and watch path
const activeWatches = new Map(); // ws -> Map(watchPath -> request)

/**
 * Retrieve resourceVersion by listing the resource first.
 */
function getResourceVersion(fullPath) {
  return new Promise((resolve, reject) => {
    request.get(
      `${kc.getCurrentCluster().server}${fullPath}`,
      opts,
      (error, response, body) => {
        if (error) {
          return reject(error);
        }

        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          console.warn(`Unexpected content-type at ${fullPath}: ${contentType}`);
          resolve('');
          return;
        }

        try {
          const json = JSON.parse(body);
          if (json && json.metadata && json.metadata.resourceVersion) {
            resolve(json.metadata.resourceVersion);
          } else {
            console.warn(`No resourceVersion in JSON response for ${fullPath}`);
            resolve('');
          }
        } catch (err) {
          console.error(`Error parsing JSON for ${fullPath}:`, err.message);
          resolve('');
        }
      }
    );
  });
}

/**
 * Start a watch and send updates via WebSocket.
 */
function startWatch(ws, path, resourceVersion) {
  const watchRequest = watch.watch(
    path,
    { allowWatchBookmarks: true, resourceVersion: resourceVersion },
    (type, apiObj) => {
      try {
        ws.send(
          JSON.stringify({
            ts: Date.now(),
            type: type,
            apiObj: apiObj,
          })
        );
      } catch (err) {
        console.error(`Error sending WebSocket data for path ${path}:`, err.message);
      }
    },
    (err) => {
      if (err) {
        console.error(`Watch error for path ${path}:`, err.message);
      }

      /*
      // Don't restart watches, otherwise watches can't be stopped
      setTimeout(() => {
        getResourceVersion(path)
          .then((rv) => startWatch(ws, path, rv))
          .catch((err) => console.error(`Error restarting watch for ${path}:`, err.message));
      }, 10 * 1000);
      */
    }
  );

  watchRequest
    .then((req) => {
      console.log(`Started watch for path ${path}`);

      // Store the watch request
      if (!activeWatches.has(ws)) {
        activeWatches.set(ws, new Map());
      }
      activeWatches.get(ws).set(path, req);
    })
    .catch((err) => {
      console.error(`Error starting watch for path ${path}:`, err.message);
    });

  return watchRequest;
}

/**
 * List resources and start watches for watchable resources.
 */
function listThenWatch(ws, path) {
  request.get(`${kc.getCurrentCluster().server}${path}`, opts, (error, response, body) => {
    if (error) {
      console.error(`Error listing path ${path}: ${error}`);
      return;
    }

    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      console.warn(`Skipping non-JSON response for path ${path}. Content-Type: ${contentType}`);
      return;
    }

    try {
      const json = JSON.parse(body);
      if (json && json.resources) {
        json.resources.forEach((resource) => {
          if (resource.verbs && resource.verbs.includes('watch')) {
            const watchPath = path.endsWith('/') ? `${path}${resource.name}` : `${path}/${resource.name}`;
            getResourceVersion(watchPath)
              .then((rv) => {
                startWatch(ws, watchPath, rv);
              })
              .catch((err) => console.error(`Error getting resourceVersion for ${watchPath}:`, err));
          }
        });
      }
    } catch (err) {
      console.error(`Error parsing JSON for path ${path}:`, err.message);
    }
  });
}

/**
 * List resources, filter by apiVersion, and start watches.
 */
function listThenWatchWithFilter(ws, path, apiVersion) {
  request.get(`${kc.getCurrentCluster().server}${path}`, opts, (error, response, body) => {
    if (error) {
      console.error(`Error listing path ${path}: ${error}`);
      return;
    }

    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      console.warn(`Skipping non-JSON response for path ${path}. Content-Type: ${contentType}`);
      return;
    }

    try {
      const json = JSON.parse(body);

      if (json && json.resources) {
        const derivedApiVersion = path.startsWith('/api/')
          ? path.replace('/api/', '').split('/')[0]
          : path.replace('/apis/', '');

        json.resources
          .filter((resource) => {
            return `${derivedApiVersion}/${resource.kind}`.startsWith(apiVersion);
          })
          .forEach((resource) => {
            if (resource.verbs && resource.verbs.includes('watch')) {
              const watchPath = path.endsWith('/') ? `${path}${resource.name}` : `${path}/${resource.name}`;
              getResourceVersion(watchPath)
                .then((rv) => {
                  startWatch(ws, watchPath, rv);
                })
                .catch((err) => console.error(`Error getting resourceVersion for ${watchPath}:`, err));
            }
          });
      }
    } catch (err) {
      console.error(`Error parsing JSON response for path ${path}:`, err.message);
    }
  });
}

wss.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    let config;
    try {
      config = JSON.parse(data);
    } catch (err) {
      console.error('Invalid JSON received:', data);
      return;
    }

    // Stop all existing watches for this ws
    if (activeWatches.has(ws)) {
      console.log(`Stopping all watches for this WebSocket connection`);
      activeWatches.get(ws).forEach((req, path) => {
        req.abort();
        console.log(`Stopped watch for path: ${path}`);
      });
      activeWatches.delete(ws);
    }

    if (config.apiVersion) {
      console.log(`Watching resources with apiVersion: ${config.apiVersion}`);

      request.get(`${kc.getCurrentCluster().server}`, opts, (error, response, body) => {
        if (error) {
          console.error(`Error fetching paths: ${error}`);
          process.exit();
        }

        JSON.parse(body).paths.forEach((path) => {
          listThenWatchWithFilter(ws, path, config.apiVersion);
        });
      });
    } else {
      console.log('Watching all resources.');

      request.get(`${kc.getCurrentCluster().server}`, opts, (error, response, body) => {
        if (error) {
          console.error(`Error fetching paths: ${error}`);
          process.exit();
        }

        JSON.parse(body).paths.forEach((path) => {
          listThenWatch(ws, path);
        });
      });
    }
  });

  ws.on('close', () => {
    // Stop all watches associated with this ws when it closes
    if (activeWatches.has(ws)) {
      activeWatches.get(ws).forEach((req, path) => {
        req.abort();
        console.log(`Stopped watch on close for path: ${path}`);
      });
      activeWatches.delete(ws);
    }
  });
});

server.listen(process.env.PORT, function () {
  console.log(`http/ws server listening on ${process.env.PORT}`);
});