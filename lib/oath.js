
var _ = require('underscore');

// Since objects only compare === to the same object (i.e. the same reference)
// we can do something like this instead of using integer enums because we can't
// ever accidentally compare these to other values and get a false-positive.
//
// For instance, `rejected === resolved` will be false, even though they are
// both {}.
var rejected = {}, resolved = {}, waiting = {};

// This is a promise. It's a value with an associated temporal
// status. The value might exist or might not, depending on
// the status.
var Promise = function (value, status) {

  this.value  = value;
  this.status = status || waiting;

  // So we can pass these methods as callbacks without having to worry about
  // putting .bind(this) everywhere
  _.bindAll(this, 'then', 'catch', 'fulfill', 'abandon');
  };

// The user-facing way to add functions that want
// access to the value in the promise when the promise
// is resolved.
Promise.prototype.then = function (success, _failure) {

  // If we already have a callback registered, then throw an error.
  if (this.owed) {
    throw new Error('Tried to then a promise twice.');
  }


  // Register the provided callback to be given the value.
  this.owed = success;

  // Create the next deferral in the chain. The associated promise
  // will be returned so that we can chain calls to .then() and catch().
  this.next = defer();

  // If the promise was resolved before the first call to then,
  // immediately call the success callback and passthrough
  // to the next .then() in the chain, if there is one.
  if (this.status === resolved) {
    this.fulfill(this.value, true); // Force the call to go through.
  }

  // Register the other callback for failure.
  if (_failure) { this.catch(_failure); }

  // Return the next promise, to allow for chaining .then() calls.
  return this.next.promise;
  };


// The user-facing way to add functions that should fire on an error. This
// can be called at the end of a long chain of .then()s to catch all .reject()
// calls that happened at any time in the .then() chain. This makes chaining
// multiple failable computations together extremely easy.
Promise.prototype.catch = function (failure) {

  // Just like with then, only one failure function can be registered.
  // Multiple calls to catch() will throw this error.
  if (this.onFail) {
    throw new Error('Tried to catch a promise twice.');
  }

  // Register our callback.
  this.onFail = failure;

  // If this promise has already been rejected we should immediately
  // invoke the failure callback.
  if (this.status === rejected) {
    this.abandon(this.value, true);
  }
  };


// The internal mechanism for triggering a promise that has been resolved.
// This will call the appropriate functions with the data passed in to
// enable all of the wonderful behavior of promises.
Promise.prototype.fulfill = function (data, force) {
  // If fulfilled has already been called, i.e. if you have resolved
  // this promise already and try to do it again, then we throw
  // an Error.
  // We are leaving the force option here so we can call this internally
  // to override this behavior.
  if (this.status !== waiting && !force) {
    throw new Error('Tried to fulfill a promise twice.');
  }

  // Set the status to resolved, so future .fulfill()s will throw errors.
  this.status = resolved;

  // If there's no registered function, just don't do anything.
  if (this.owed) {
    this.value = this.owed(data);

    // If this.value is a promise, pass it's value on through next.
    if (this.value && this.value.then) {
      // Resolve next with the value from the success function when
      // the promise returned by the success function resolves.
      this.value.then(this.next.resolve);

      // Interrupt a success chain with a failure. We call
      // this.next.reject on a failure, which causes the failure
      // to propagate down the chain.
      this.value.catch(this.next.reject);
    }
  }
};

// The internal mechanism for failing a promise. I really wanted
// to call this function break because you either break or
// fulfill a promise, but break is a keyword so abandon has to do.
Promise.prototype.abandon = function (error, force) {
  // Same thing here as in fulfill.
  if (this.status !== waiting && !force) {
    throw new Error('Tried to abandon a promise twice.');
  }

  // Set the status of the promise.
  this.status = rejected;
  // If there's a registered failure function, fire it.
  if (this.onFail) {
    this.value = error;
    this.onFail(error);
  } else {
    if (this.next) {
      // If there is no catch function registered immediately on
      // this promise, but there is a next, then propagate the failure
      // onwards to look for a catch somewhere.
      this.next.reject(error);
    }
  }

  // If none of these things, then nobody is listening for a failure
  // so we just drop it.
};

// This is the object returned by defer() that manages a promise.
// It provides an interface for resolving and rejecting promises
// and also provides a way to extract the promise it contains.
var Deferred = function (promise) {

  this.promise = promise;

  // This lets us use defer.resolve and defer.reject as callbacks
  // without worrying about doing .bind(this) everywhere.
  _.bindAll(this, 'resolve', 'reject');
  };

// Resolve the contained promise with data.
//
// This will be called by the creator of the promise when the data
// associated with the promise is ready.
Deferred.prototype.resolve = function (data) {

  this.promise.fulfill(data);
  };

// Reject the contained promise with an error.
//
// This will be called by the creator of the promise when there is
// an error in getting the data associated with the promise.
Deferred.prototype.reject = function (error) {

  this.promise.abandon(error);
  };

// The external interface for creating promises
// and resolving them. This returns a Deferred
// object with an empty promise.
var defer = function () {

  return new Deferred(new Promise());
  };

 // Extra Credit.
// Abstracts away a common node pattern.
var failable = function (nodeStyle, error, success) {
  nodeStyle(function (err, data) {
    if (err) {
      // Call the error function if there is an error.
      error(err);
    } else {
      // Call the success function if we get data.
      success(data);
    }
  });
  // Now we can do something like:
  // failable(fs.readFile, console.error, sendData);
};

// Creates a promise out of a node-style callback function.
var promisify = function (nodeStyle, context) {
  // The promisified function
  return function () {
    var args = _.toArray(arguments);
    var deferred = defer();
    // Make the async call.
    failable(
      // Here we can re-use the classic failable pattern by wrapping
      // nodeStyle in a function that takes only a callback and doing
      // some arguments/apply magic to it.
      function (cb) { nodeStyle.apply(context, args.concat([cb])); },
      // failable takes an error and a success function, which are actually
      // just .reject and .resolve in our case, making this very simple.
      deferred.reject,
      deferred.resolve
    );
    // Promisified functions should return promises.
    return deferred.promise;
  };
};

// Construct an already-resolved promise containing the passed-in value.
var resolved = function (value) {
  return new Promise(value, resolved);
};

// Construct an already-rejected promise containg the passed-in error.
var rejected = function (error) {
  return new Promise(error, rejected);
};

module.exports.promisify = promisify;
module.exports.resolved = resolved;
module.exports.rejected = rejected;
module.exports.defer = defer;

