/**
 * @license
 * Copyright 2017 The Web Activities Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ActivityWindowPopupHost,
  ActivityWindowRedirectHost,
} from '../../src/activity-window-host';
import {ActivityMode} from '../../src/activity-types';
import {getWindowOrigin, serializeRequest} from '../../src/utils';


describes.realWin('ActivityWindowPopupHost', {}, env => {
  let win, doc;
  let host;
  let opener;
  let messenger;
  let closer, closeSpy;
  let container;

  beforeEach(() => {
    win = env.win;
    doc = win.document;
    opener = {
      postMessage: sandbox.spy(),
    };
    Object.defineProperty(win, 'opener', {value: opener});

    host = new ActivityWindowPopupHost(win);
    messenger = host.messenger_;

    closer = () => {};
    closeSpy = sandbox.stub(win, 'close', function() {
      closer();
    });

    container = doc.createElement('div');
    doc.body.appendChild(container);
    host.setSizeContainer(container);
  });

  afterEach(() => {
    messenger.disconnect();
  });

  it('should return mode', () => {
    expect(host.getMode()).to.equal(ActivityMode.POPUP);
  });

  it('should fail before connected', () => {
    expect(() => {
      messenger.getTarget();
    }).to.throw(/not connected/);
    expect(() => {
      messenger.getTargetOrigin();
    }).to.throw(/not connected/);
  });

  it('should initialize messenger on connect', () => {
    const sendCommandStub = sandbox.stub(messenger, 'sendCommand');
    const redirectConnectPromise = Promise.resolve();
    const redirectConnectStub =
        sandbox.stub(host.redirectHost_, 'connect',
            () => redirectConnectPromise);
    host.connect('{}');
    expect(redirectConnectStub).to.be.calledWith('{}');
    return redirectConnectPromise.then(() => {
      expect(messenger.getTarget()).to.equal(opener);
      expect(() => {
        messenger.getTargetOrigin();
      }).to.throw(/not connected/);
      expect(() => {
        host.isTargetOriginVerified();
      }).to.throw(/not connected/);
      expect(() => {
        host.getArgs();
      }).to.throw(/not connected/);
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('connect');
      expect(host.connected_).to.be.false;
      expect(messenger.onCommand_).to.exist;

      // Disconnect.
      const disconnectStub = sandbox.stub(messenger, 'disconnect');
      host.disconnect();
      expect(disconnectStub).to.be.calledOnce;
    });
  });

  it('should close window on disconnect', () => {
    expect(closeSpy).to.not.be.called;
    host.disconnect();
    expect(closeSpy).to.be.calledOnce;
  });

  it('should tolerate close window failures on disconnect', () => {
    closer = () => {
      throw new Error('intentional');
    };
    host.disconnect();
    expect(closeSpy).to.be.calledOnce;
  });

  it('should continue with popup host if connect arrives on time', () => {
    sandbox.stub(messenger, 'sendCommand');
    const request = {
      requestId: 'request1',
      returnUrl: 'https://example.com/opener',
    };
    const connectPromise = host.connect(request);
    return Promise.resolve().then(() => {
      // Skip microtask.
      return Promise.resolve();
    }).then(() => {
      messenger.handleEvent_({
        origin: 'https://example-pub.com',
        data: {
          sentinel: '__ACTIVITIES__',
          cmd: 'start',
        },
      });
      return connectPromise;
    }).then(host => {
      expect(host).to.be.instanceof(ActivityWindowPopupHost);
    });
  });

  it('should fallback to redirect on connect timeout', () => {
    const clock = sandbox.useFakeTimers();
    sandbox.stub(messenger, 'sendCommand');
    const request = {
      requestId: 'request1',
      returnUrl: 'https://example.com/opener',
    };
    const connectPromise = host.connect(request);
    return Promise.resolve().then(() => {
      // Skip microtask.
      return Promise.resolve();
    }).then(() => {
      clock.tick(6000);
      return connectPromise;
    }).then(host => {
      expect(host).to.be.instanceof(ActivityWindowRedirectHost);
    });
  });

  it('should failed to return properties before connect', () => {
    expect(() => host.getRequestString())
        .to.throw(/not connected/);
    expect(() => host.getTargetOrigin())
        .to.throw(/not connected/);
    expect(() => host.isTargetOriginVerified())
        .to.throw(/not connected/);
    expect(() => host.getArgs())
        .to.throw(/not connected/);
  });

  it('should not accept before connection', () => {
    expect(() => host.accept())
        .to.throw(/not connected/);
  });

  describe('commands', () => {
    let connectPromise;
    let onEvent;
    let sendCommandStub;
    let clock;
    let request;

    beforeEach(() => {
      clock = sandbox.useFakeTimers();
      request = {
        requestId: 'request1',
        returnUrl: 'https://example-pub.com/opener',
        args: {a: 1},
      };
      connectPromise = host.connect(request);
      return Promise.resolve().then(() => {
        // Skip a microtask.
        return Promise.resolve();
      }).then(() => {
        onEvent = messenger.handleEvent_.bind(messenger);
        sendCommandStub = sandbox.stub(messenger, 'sendCommand');
        onCommand('start', {a: 1});
      });
    });

    afterEach(() => {
      host.disconnect();
    });

    function onCommand(cmd, payload) {
      onEvent({
        origin: 'https://example-pub.com',
        data: {
          sentinel: '__ACTIVITIES__',
          cmd,
          payload,
        },
      });
    }

    it('should return connect properties', () => {
      expect(host.getTargetOrigin()).to.equal('https://example-pub.com');
      expect(host.isTargetOriginVerified()).to.be.true;
      expect(host.isSecureChannel()).to.be.true;
      expect(host.getArgs()).to.deep.equal({a: 1});
    });

    it('should return the request', () => {
      expect(host.getRequestString())
          .to.be.equal(serializeRequest(request));
    });

    it('should handle "start" and "close"', () => {
      const disconnectStub = sandbox.stub(host, 'disconnect');
      return connectPromise.then(connectResult => {
        expect(connectResult).to.equal(host);
        expect(messenger.getTarget()).to.equal(opener);
        expect(host.getTargetOrigin()).to.equal('https://example-pub.com');
        expect(host.getArgs()).to.deep.equal({a: 1});
        expect(host.connected_).to.be.true;

        expect(disconnectStub).to.not.be.called;
        onCommand('close');
        expect(disconnectStub).to.be.calledOnce;
      });
    });

    it('should not allow result/cancel/fail before accept', () => {
      expect(() => host.result('abc'))
          .to.throw(/not accepted/);
      expect(() => host.cancel())
          .to.throw(/not accepted/);
      expect(() => host.failed(new Error('intentional')))
          .to.throw(/not accepted/);
    });

    it('should yield "result"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.result('abc');
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('result', {
        code: 'ok',
        data: 'abc',
      });
      // Do not disconnect, wait for "close" message to ack the result receipt.
      expect(disconnectStub).to.not.be.called;
    });

    it('should yield "result" with null', () => {
      host.accept();
      host.result(null);
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('result', {
        code: 'ok',
        data: null,
      });
    });

    it('should yield "canceled"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.cancel();
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('result', {
        code: 'canceled',
        data: null,
      });
      expect(disconnectStub).to.not.be.called;
    });

    it('should yield "failed"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.failed(new Error('broken'));
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('result', {
        code: 'failed',
        data: 'Error: broken',
      });
      expect(disconnectStub).to.not.be.called;
    });

    it('should not allow "ready" signal before accept', () => {
      expect(() => host.ready())
          .to.throw(/not accepted/);
    });

    it('should send "ready" signal', () => {
      host.accept();

      // Ready.
      host.ready();
      expect(sendCommandStub).to.be.calledOnce;
      expect(sendCommandStub).to.be.calledWith('ready');

      // Disconnect.
      host.disconnect();
    });

    it('should handle "resized"', () => {
      const callback = sandbox.spy();
      host.onResizeComplete(callback);
      expect(callback).to.not.be.called;

      const availableHeight = win.innerHeight;
      const requestedHeight = (availableHeight - 10);
      container.style.height = requestedHeight + 'px';
      host.resized();
      clock.tick(100);
      expect(callback).to.be.calledOnce;
      expect(callback).to.be.calledWith(
          /* allowedHeight */ availableHeight,
          /* requestedHeight */ requestedHeight,
          /* overfow */ false);
    });

    it('should handle "resized" with overflow', () => {
      const callback = sandbox.spy();
      host.onResizeComplete(callback);
      expect(callback).to.not.be.called;

      const availableHeight = win.innerHeight;
      const requestedHeight = (availableHeight + 10);
      container.style.height = requestedHeight + 'px';
      host.resized();
      clock.tick(100);
      expect(callback).to.be.calledOnce;
      expect(callback).to.be.calledWith(
          /* allowedHeight */ availableHeight,
          /* requestedHeight */ requestedHeight,
          /* overfow */ true);
    });
  });
});


describes.realWin('ActivityWindowRedirectHost', {}, env => {
  let win, doc;
  let host;
  let closeSpy;
  let container;
  let redirectStub;

  beforeEach(() => {
    win = env.win;
    doc = win.document;
    host = new ActivityWindowRedirectHost(win);
    redirectStub = sandbox.stub(host, 'redirect_');
    closeSpy = sandbox.stub(win, 'close');
    container = doc.createElement('div');
    doc.body.appendChild(container);
    host.setSizeContainer(container);
  });

  afterEach(() => {
    expect(closeSpy).to.not.be.called;
  });

  it('should return mode', () => {
    expect(host.getMode()).to.equal(ActivityMode.REDIRECT);
  });

  it('should failed to return properties before connect', () => {
    expect(() => host.getRequestString())
        .to.throw(/not connected/);
    expect(() => host.getTargetOrigin())
        .to.throw(/not connected/);
    expect(() => host.isTargetOriginVerified())
        .to.throw(/not connected/);
    expect(() => host.getArgs())
        .to.throw(/not connected/);
  });

  it('should not accept before connection', () => {
    expect(() => host.accept())
        .to.throw(/not connected/);
  });

  it('should connect with request object', () => {
    const request = {
      requestId: 'request1',
      returnUrl: 'https://example.com/opener',
      args: {a: 1},
    };
    expect(() => {
      host.getTargetOrigin();
    }).to.throw(/not connected/);
    expect(() => {
      host.isTargetOriginVerified();
    }).to.throw(/not connected/);
    expect(() => {
      host.getArgs();
    }).to.throw(/not connected/);
    expect(host.connected_).to.be.false;
    return host.connect(request).then(result => {
      expect(host.connected_).to.be.true;
      expect(host.accepted_).to.be.false;
      expect(result).to.equal(host);
      expect(host.getTargetOrigin()).to.equal('https://example.com');
      expect(host.isTargetOriginVerified()).to.be.false;
      expect(host.isSecureChannel()).to.be.false;
      expect(host.getArgs()).to.deep.equal({a: 1});
      expect(host.getRequestString()).to.equal(serializeRequest(request));

      // Disconnect.
      host.accepted_ = true;
      host.disconnect();
      expect(host.connected_).to.be.false;
      expect(host.accepted_).to.be.false;
    });
  });

  it('should connect with request string', () => {
    const request = {
      requestId: 'request1',
      returnUrl: 'https://example.com/opener',
      args: {a: 1},
    };
    return host.connect(serializeRequest(request)).then(result => {
      expect(result).to.equal(host);
      expect(host.getTargetOrigin()).to.equal('https://example.com');
      expect(host.isTargetOriginVerified()).to.be.false;
      expect(host.isSecureChannel()).to.be.false;
      expect(host.getRequestString()).to.equal(serializeRequest(request));
    });
  });

  it('should connect with request fragment', () => {
    const request = {
      requestId: 'request1',
      returnUrl: 'https://example.com/opener',
      args: {a: 1},
    };
    win.location.hash = '#__WA__=' +
        encodeURIComponent(serializeRequest(request));
    return host.connect().then(result => {
      expect(result).to.equal(host);
      expect(host.getTargetOrigin()).to.equal('https://example.com');
      expect(host.isTargetOriginVerified()).to.be.false;
      expect(host.isSecureChannel()).to.be.false;
      expect(host.getRequestString()).to.equal(serializeRequest(request));
    });
  });

  describe('commands', () => {
    let clock;
    let request;

    beforeEach(() => {
      clock = sandbox.useFakeTimers();
      request = {
        requestId: 'request1',
        returnUrl: 'https://example-pub.com/opener',
        args: {a: 1},
      };
      return host.connect(request);
    });

    afterEach(() => {
      host.disconnect();
    });

    function returnUrl(code, data) {
      return 'https://example-pub.com/opener#__WA_RES__=' +
          encodeURIComponent(JSON.stringify({
            requestId: 'request1',
            origin: getWindowOrigin(win),
            code,
            data,
          }));
    }

    it('should return connect properties', () => {
      expect(host.getTargetOrigin()).to.equal('https://example-pub.com');
      expect(host.isTargetOriginVerified()).to.be.false;
      expect(host.isSecureChannel()).to.be.false;
      expect(host.getArgs()).to.deep.equal({a: 1});
    });

    it('should return the request', () => {
      expect(host.getRequestString())
          .to.be.equal(serializeRequest(request));
    });

    it('should not allow result/cancel/fail before accept', () => {
      expect(() => host.result('abc'))
          .to.throw(/not accepted/);
      expect(() => host.cancel())
          .to.throw(/not accepted/);
      expect(() => host.failed(new Error('intentional')))
          .to.throw(/not accepted/);
    });

    it('should yield "result"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.result('abc');
      expect(redirectStub).to.be.calledOnce;
      expect(redirectStub).to.be.calledWith(returnUrl('ok', 'abc'));
      // Do not disconnect, wait for "close" message to ack the result receipt.
      expect(disconnectStub).to.not.be.called;
    });

    it('should yield "result" with null', () => {
      host.accept();
      host.result(null);
      expect(redirectStub).to.be.calledOnce;
      expect(redirectStub).to.be.calledWith(returnUrl('ok', null));
    });

    it('should yield "canceled"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.cancel();
      expect(redirectStub).to.be.calledOnce;
      expect(redirectStub).to.be.calledWith(returnUrl('canceled', null));
      expect(disconnectStub).to.not.be.called;
    });

    it('should yield "failed"', () => {
      host.accept();
      const disconnectStub = sandbox.stub(host, 'disconnect');
      host.failed(new Error('broken'));
      expect(redirectStub).to.be.calledOnce;
      expect(redirectStub).to.be.calledWith(
          returnUrl('failed', 'Error: broken'));
      expect(disconnectStub).to.not.be.called;
    });

    it('should not allow "ready" signal before accept', () => {
      expect(() => host.ready())
          .to.throw(/not accepted/);
    });

    it('should ignore "ready" signal', () => {
      host.accept();
      host.ready();
    });

    it('should handle "resized"', () => {
      const callback = sandbox.spy();
      host.onResizeComplete(callback);
      expect(callback).to.not.be.called;

      const availableHeight = win.innerHeight;
      const requestedHeight = (availableHeight - 10);
      container.style.height = requestedHeight + 'px';
      host.resized();
      clock.tick(100);
      expect(callback).to.be.calledOnce;
      expect(callback).to.be.calledWith(
          /* allowedHeight */ availableHeight,
          /* requestedHeight */ requestedHeight,
          /* overfow */ false);
    });

    it('should handle "resized" with overflow', () => {
      const callback = sandbox.spy();
      host.onResizeComplete(callback);
      expect(callback).to.not.be.called;

      const availableHeight = win.innerHeight;
      const requestedHeight = (availableHeight + 10);
      container.style.height = requestedHeight + 'px';
      host.resized();
      clock.tick(100);
      expect(callback).to.be.calledOnce;
      expect(callback).to.be.calledWith(
          /* allowedHeight */ availableHeight,
          /* requestedHeight */ requestedHeight,
          /* overfow */ true);
    });
  });
});