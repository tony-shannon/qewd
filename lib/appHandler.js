/*!

 ----------------------------------------------------------------------------
 | qewd: Quick and Easy Web Development                                     |
 |                                                                          |
 | Copyright (c) 2017 M/Gateway Developments Ltd,                           |
 | Reigate, Surrey UK.                                                      |
 | All rights reserved.                                                     |
 |                                                                          |
 | http://www.mgateway.com                                                  |
 | Email: rtweed@mgateway.com                                               |
 |                                                                          |
 |                                                                          |
 | Licensed under the Apache License, Version 2.0 (the "License");          |
 | you may not use this file except in compliance with the License.         |
 | You may obtain a copy of the License at                                  |
 |                                                                          |
 |     http://www.apache.org/licenses/LICENSE-2.0                           |
 |                                                                          |
 | Unless required by applicable law or agreed to in writing, software      |
 | distributed under the License is distributed on an "AS IS" BASIS,        |
 | WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. |
 | See the License for the specific language governing permissions and      |
 |  limitations under the License.                                          |
 ----------------------------------------------------------------------------

  29 April 2017

*/

var getFragment = require('./getFragment');
var resilientMode = require('./resilientMode');

function loadModule(application, finished) {
  try {
    var moduleName = application;
    if (this.userDefined.config.moduleMap && this.userDefined.config.moduleMap[application]) {
      moduleName = this.userDefined.config.moduleMap[application];
    }
    var appModule = require(moduleName);
    if (appModule.handlers) this.handlers[application] = appModule.handlers;
    if (appModule.beforeHandler) {
      this.beforeHandlers[application] = appModule.beforeHandler;
    }
    if (appModule.afterHandler) {
      this.afterHandlers[application] = appModule.afterHandler;
    }
    if (appModule.servicesAllowed) this.servicesAllowed[application] = appModule.servicesAllowed;
    // provide an initialisation point to load stuff like documentStore event handlers for indexing
    if (appModule.init && typeof appModule.init === 'function') appModule.init.call(this, application);
    console.log('loadModule: handler module loaded for application ' + application + '; module: ' + moduleName);
    return true;
  }
  catch(err) {
    var error = 'Unable to load handler module for: ' + application;
    if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['moduleLoadError']) error = this.errorMessages[application]['moduleLoadError'];
    console.log(error + ': ' + err);
    finished({
      error: error,
      reason: err
    });
    return false;
  }
}

function customError(errorObj) {
  var error;
  if (typeof errorObj === 'string') {
    error = {error: errorObj};
  }
  else {
    error = {
      error: errorObj.text,
      status: {
        code: errorObj.statusCode
      }
    };
  }
  return error;
}

module.exports = function() {

  this.on('message', function(messageObj, sendFn, finishedFn) {

    var finished = finishedFn;
    if (this.userDefined.config.resilientMode && messageObj.dbIndex) {
      var q = this;
      // create special version of finished function to log worker processing progress
      finished = function(responseObj) {
        if (responseObj.error) {
          resilientMode.storeWorkerStatusUpdate.call(q, messageObj, 'error');
        }
        else {
          resilientMode.storeWorkerStatusUpdate.call(q, messageObj, 'finished');
        }
        finishedFn(responseObj);
      };
      resilientMode.storeWorkerStatusUpdate.call(q, messageObj, 'started');
    }

    var error;
    var errorObj;
    if (!this.documentStore) {
      error = {error: 'No Document Store has been created - you must use ewd-document-store!'};
      if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['noDocumentStore']) 
        errorObj = customError(this.errorMessages[application]['noDocumentStore']);
        if (errorObj) error = errorObj;
      finished(error);
      return;
    }

    var session;
    var application;
    var type = messageObj.type;
    var send = sendFn;

    if (type === 'ewd-qoper8-express') {
      //if (messageObj.body && messageObj.body.type) {
      if (messageObj.headers && messageObj.headers.qewd && messageObj.headers.qewd === 'ajax') {
        // this must be an ewd-xpress message sent over Ajax
        var ip = messageObj.ip;
        var ips = messageObj.ips;
        messageObj = messageObj.body;
        type = messageObj.type;
        if (type === 'ewd-register') {
          messageObj.ipAddress = ip;
        }
        messageObj.ip = ip;
        messageObj.ips = ips;
        // can't use the send() function over Ajax so disable it to prevent a server-side crash
        send = function(msg) {
          console.log('** Unable to use send() function over Ajax for intermediate message ' + JSON.stringify(msg));
        };
      }
      else if (messageObj.expressType) {
        type = messageObj.expressType;
      }
      if (messageObj.application) {
        application = messageObj.application;
        if (!this.restModule) this.restModule = {};
        if (!this.handlers[application]) {
          try {
            var moduleName = application;
            if (this.userDefined.config.moduleMap && this.userDefined.config.moduleMap[application]) {
              moduleName = this.userDefined.config.moduleMap[application];
            }
            var appModule = require(moduleName);
            if (appModule.handlers) this.handlers[application] = appModule.handlers;

            if (appModule.beforeHandler) {
              this.beforeHandlers[application] = appModule.beforeHandler;
            }
            if (appModule.afterHandler) {
              this.afterHandlers[application] = appModule.afterHandler;
            }
            if (appModule.servicesAllowed) this.servicesAllowed[application] = appModule.servicesAllowed;
            if (appModule.restModule === true) this.restModule[application] = true;
            if (appModule.init && typeof appModule.init === 'function') appModule.init.call(this, application);
            console.log('handler module loaded for ' + application);
          }
          catch(err) {
            error = 'Unable to load handler module for: ' + application;
            if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['moduleLoadError']) error = this.errorMessages[application]['moduleLoadError'];
            console.log(error + ': ' + err);
            finished({
              error: error,
              reason: err
            });
            return;
          }
        }
        // If this is defined as a rest application, invoke its type handler now
        if (this.restModule[application]) {
          if (this.handlers[application][type]) {
            // invoke the handler for this message
            var fin = function(results) {
              results.restMessage = true;
              //results.type = type;
              results.ewd_application = application;
              finished(results);
            };
            if (this.beforeHandlers[application]) {
              status = this.beforeHandlers[application].call(this, messageObj, fin);
              if (status === false) return;
            }
            this.handlers[application][type].call(this, messageObj, fin);
            if (this.afterHandlers[application]) {
              this.afterHandlers[application].call(this, messageObj, fin);
            }
          }
          else {
            error = {error: 'No handler defined for ' + application + ' messages of type ' + type};
            if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['noTypeHandler']) {
              errorObj = customError(this.errorMessages[application]['noTypeHandler']);
              if (errorObj) error = errorObj;
            }
            finished(error);
          }
          return;
        }
      }
      console.log('ewd-qoper8-express message remapped to: type ' + type + ': ' + JSON.stringify(messageObj));
    }

    if (type === 'ewd-register') {
      // register a new application user
      session = this.sessions.create(messageObj.application, this.userDefined.config.initialSessionTimeout);
      if (messageObj.socketId) session.socketId = messageObj.socketId;
      session.ipAddress = messageObj.ipAddress;
      finished({token: session.token});
      return;
    }

    var result = this.sessions.authenticate(messageObj.token, 'noCheck');
    if (result.error) {
      error = result.error;
      if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['sessionNotAuthenticated']) error = this.errorMessages[application]['sessionNotAuthenticated'];
      finished({
        error: error,
        disconnect: true
      });
      return;
    }
    session = result.session;

    if (type === 'ewd-reregister') {
      console.log('re-register token ' + messageObj.token);
      session.socketId = messageObj.socketId;
      finished({ok: true});
      return;
    }

    session.updateExpiry();
    var application = session.application;

    if (type === 'ewd-fragment') {
      if (messageObj.service && !this.servicesAllowed[application]) {
        var ok = loadModule.call(this, application, finished);
        if (!ok) return;
      }
      var responseObj = getFragment.call(this, messageObj, application, finished);
      return;
    }

    // if no handlers have yet been loaded for the incoming application request
    //  load them now...

    if (!this.handlers[application]) {
      var ok = loadModule.call(this, application, finished);
      if (!ok) return;
    }

    // session lockng - has to be specifically switched on!
    if (this.userDefined.config.lockSession) {
      var timeout = this.userDefined.config.lockSession.timeout || 30;
      this.sessionLocked = {
        global: this.userDefined.config.sessionDocumentName,
        subscripts: ["session", session.id]
      };
      console.log('*** session locked: ' + JSON.stringify(this.sessionLocked));
      var ok = this.db.lock(this.sessionLocked, timeout);
      if (ok.result.toString() === '0') {
        finished({error: 'Timed out waiting for EWD session to be released'});
        return;
      }
    }

    // is this a service request, and if so, is it allowed for this application?

    var appHandlers = this.handlers[application];
    var servicesAllowed = this.servicesAllowed[application];
    var service = messageObj.service;

    if (service) {
      // this is a request for a service handler
      //  first, check if the service is permitted for the user's application, and if so,
      //  make sure the service handlers are loaded

      var allowService = false;
      var sessionAllowService;
      if (servicesAllowed && servicesAllowed[service]) allowService = true;
      // can be over-ridden by session-specific service allowance
      if (typeof session.allowedServices[service] !== 'undefined') {
        allowService = session.allowedServices[service];
        sessionAllowService = allowService;
      }

      if (allowService) {
        if (!this.handlers[service]) {
          try {
            //this.handlers[service] = require(service).handlers;
            var ok = loadModule.call(this, service, finished);
            if (!ok) return;
            //console.log('service module loaded for ' + service);
          }
          catch(err) {
            error = 'Unable to load handler module: ' + service;
            if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['serviceModuleLoad']) error = this.errorMessages[application]['serviceModuleLoad'];
            console.log(error + ': ' + err);
            finished({
              error: error,
              reason: err,
              service: service
            });
            return;
          }
        }
        if (this.handlers[service][type]) {
          // invoke the handler for this message
          if (this.beforeHandlers[service]) {
            status = this.beforeHandlers[service].call(this, messageObj, session, send, finished);
            if (status === false) return;
          }
          this.handlers[service][type].call(this, messageObj, session, send, finished);
          if (this.afterHandlers[service]) {
            this.afterHandlers[service].call(this, messageObj, session, send, finished);
          }
          return;
        }
        else {
          error = 'No handler defined for ' + service + ' service messages of type ' + type;
          if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['noServiceModuleType']) error = this.errorMessages[application]['noServiceModuleType'];
          finished({
            error: error,
            service: service
          });
          return;
        }        
      }
      else {
        error = service + ' service is not permitted for the ' + application + ' application';
        if (sessionAllowService === false) error = 'You are not allowed access to the ' + service + ' service';
        if (this.errorMessages && this.errorMessages[application]) {
          if (this.errorMessages[application]['serviceNotAllowed']) error = this.errorMessages[application]['serviceNotAllowed'];
          if (sessionAllowService === false && this.errorMessages[application]['serviceNotAllowedForUser']) error = this.errorMessages[application]['serviceNotAllowedForUser'];
        }
        finished({
          error: error,
          service: service
        })
        return;
      }
    }

    // handlers are available for this user's application
    // try to invoked the appropriate one for the incoming request

    if (this.handlers[application][type]) {
      // invoke the handler for this message
      var fin = function(results) {
        results = results || {};
        results.ewd_application = application;
        finished(results);
      };
      if (this.beforeHandlers[application]) {
        status = this.beforeHandlers[application].call(this, messageObj, session, send, fin);
        if (status === false) return;
      }
      this.handlers[application][type].call(this, messageObj, session, send, fin);
      if (this.afterHandlers[application]) {
        this.afterHandlers[application].call(this, messageObj, session, send, fin);
      }
    }
    else {
      error = {error: 'No handler defined for ' + application + ' messages of type ' + type};
      if (this.errorMessages && this.errorMessages[application] && this.errorMessages[application]['noTypeHandler']) {
        errorObj = customError(this.errorMessages[application]['noTypeHander']);
        if (errorObj) error = errorObj;
      }
      finished(error);
    }

  });
  
};
