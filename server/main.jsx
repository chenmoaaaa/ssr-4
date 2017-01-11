import { checkNpmVersions } from 'meteor/tmeasday:check-npm-versions';
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import logger from './logger';
import { perfStart, perfStop } from './perfMeasure';
import createDataContext from './dataContext';
import cache from './cache';

checkNpmVersions({
  react: '15.x',
  'react-dom': '15.x',
  express: '4.x',
  helmet: '3.x',
  'react-helmet': '3.x',
}, 'ssrwpo:ssr');

/* eslint-disable import/no-mutable-exports, import/no-unresolved,
                  import/no-extraneous-dependencies,
                  import/no-mutable-exports */
const React = require('react');
const { renderToString } = require('react-dom/server');
const express = require('express');
const helmet = require('helmet');
const { rewind } = require('react-helmet');

// For debug purposes
let debugLastRequest = null;
let debugLastResponse = null;
/* eslint-enable */

let nextTick = fct => Meteor.defer(() => fct());
nextTick = Meteor.bindEnvironment(nextTick);

/* eslint-disable no-param-reassign */
const createRouter = (MainApp, ServerRouter, createServerRenderContext) => {
  // Create an Express server
  const app = express();
  // Secure Express
  app.use(helmet());
  // Create data context
  const { dataContext, dataMarkup } = createDataContext();
  // Avoid parsing "/api" URLs
  app.get(/^(?!\/api)/, (req, res, next) => {
    perfStart();
    debugLastRequest = req;
    debugLastResponse = res;
    const url = req.originalUrl;
    let head = null;
    let body = null;
    let hasCacheMissed = false;
    if (cache.has(url)) {
      logger.debug('Cache hit');
      const cached = cache.get(url);
      head = cached.head;
      body = cached.body;
    } else {
      logger.debug('Cache missed');
      // Create application main entry point
      const routerContext = createServerRenderContext();
      const bodyMarkup = renderToString(
        <ServerRouter location={url} context={routerContext}>
          <MainApp context={dataContext} />
        </ServerRouter>,
      );
      // const routerResult = routerContext.getResult();
      hasCacheMissed = true;
      // Create body
      body = `<div id="react">${bodyMarkup}</div>${dataMarkup}`;
      // Create head
      const helmetHead = rewind();
      head = ['title', 'meta', 'link', 'script']
        .reduce((acc, key) => `${acc}${helmetHead[key].toString()}`, '');
    }
    // Set response's head and body in Webapp's dynamic handlers
    req.dynamicHead = head;
    req.dynamicBody = body;
    // Next middleware
    next();
    // res.writeHead(404, { 'content-type': 'text/html' });
    // res.end(`<html><header><title>404</title></header><body>${body}</body></html>`);
    // Cache value on next preocess tick if required
    if (hasCacheMissed) { nextTick(() => cache.set(url, head, body)); }
    perfStop(url);
  });
  // Add Express to Meteor's connect
  WebApp.connectHandlers.use(Meteor.bindEnvironment(app));
};

// Server side exports
export default createRouter;
export {
  logger,
  // For easing debug in `meteor shell`
  debugLastRequest, debugLastResponse,
};
