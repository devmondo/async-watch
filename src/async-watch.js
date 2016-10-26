var isNode = typeof module !== "undefined" && module.exports && typeof process === "object" && typeof window === "undefined";
// Make is compatable with node.js
var nextTick = isNode ? process.nextTick : Exports.requestAnimationFrame;

var fnIdCounter = 0;
/**
 * Postpones execution until the next frame
 * Overrides keys with the newest callback
 */
var AsyncTransaction = {
   jobs: {},
   _signed: {},
   subscriptions: {},
   scheduled: false,
   __subscribers: function(subCalls) {
      // calling subscribers
      for (var i in subCalls) {
         if (subCalls.hasOwnProperty(i)) {
            var changes = {};

            subCalls[i].fn.apply(null, [subCalls[i].values]);
         }
      }
   },
   __digest: function() {
      var self = this;
      if (self.scheduled === false) {
         self.scheduled = true;
         nextTick(function() {
            self.scheduled = false;
            for (var i in self.jobs) {
               self.jobs[i]();
               delete self.jobs[i];
            }
            var subCalls = {};
            for (var i in self._signed) {
               var task = self._signed[i];
               var arrayValue = task.target();
               task.signed.apply(null, arrayValue);
               // Check for subscriptions
               if (self.subscriptions[i]) {
                  var localId = self.subscriptions[i].$id;
                  //console.log(">>", localId, arrayValue)
                  subCalls[localId] = subCalls[localId] || {
                     values: {},
                     fn: self.subscriptions[i]
                  };
                  subCalls[localId].values[task.signed.$path] = arrayValue[0];
               }
               delete self._signed[i];
            }

            self.__subscribers(subCalls);
         });
      }
   },
   signFunction: function(fn) {
      fn.$id = fn.$id || fnIdCounter++;
   },
   subscribe: function(list, cb) {
      this.signFunction(cb);
      for (var i = 0; i < list.length; i++) {
         var watcher = list[i];
         this.subscriptions[watcher.fn.$id] = cb;
      }
   },
   unsubscribe: function(list) {
      for (var i = 0; i < list.length; i++) {
         var watcher = list[i];
         delete this.subscriptions[watcher.fn.$id];
      }
   },
   sign: function(signed, target) {
      this.signFunction(signed);

      if (signed.$instant) {
         return signed.apply(null, target());
      }
      this._signed[signed.$id] = {
         target: target,
         signed: signed
      }
      return this.__digest();
   },
   cancel: function(signed) {
      delete this._signed[signed.$id];
   },
   add: function(job_id, cb, $scope) {
      cb = $scope ? cb.bind($scope) : cb;
      this.jobs[job_id] = cb;
      return this.__digest();
   }
}
var Subscribe = function(watchers, fn) {
   AsyncTransaction.subscribe(watchers, fn);
   return {
      unsubscribe: function() {
         return AsyncTransaction.unsubscribe(watchers);
      },
      destroy: function() {
         AsyncTransaction.unsubscribe(watchers);
         for (var i in watchers) {
            var watcher = watchers[i];
            watcher.destroy();
         }
      }
   }
}

/**
 * dotNotation - A helper to extract dot notation
 *
 * @param  {type} path string or array
 * @return {type}      Object { path : ['a','b'], str : 'a.b'}
 */
function dotNotation(path) {
   if (path instanceof Array) {
      return {
         path: path,
         str: path.join('.')
      }
   }
   if (typeof path !== 'string') {
      return;
   }
   return {
      path: path.split('\.'),
      str: path
   }
}

/**
 * getPropertyValue - get a value from an object with dot notation
 *
 * @param  {type} obj  Target object
 * @param  {type} path dot notation
 * @return {type}      Target object
 */
function getPropertyValue(obj, path) {

   if (path.length === 0 || obj === undefined) {
      return undefined;
   }
   var notation = dotNotation(path);
   if (!notation) {
      return;
   }
   path = notation.path;
   for (var i = 0; i < path.length; i++) {
      obj = obj[path[i]];
      if (obj === undefined) {
         return undefined;
      }
   }
   return obj;
}

/**
 * setHiddenProperty - description
 *
 * @param  {type} obj   target object
 * @param  {type} key   property name
 * @param  {type} value default value
 * @return {type}       target object
 */
function setHiddenProperty(obj, key, value) {
   Object.defineProperty(obj, key, {
      enumerable: false,
      value: value
   });
   return value;
}

var idCounter = 0;

/**
 *  AsyncWatch
 *  AsyncWatch is a small library for watching javascript/node.js objects.
 *  It uses Object.defineProperty which makes it compatible with most browsers.
 *
 * @param  {type} self           Terget object
 * @param  {type} userPath       dot notation
 * @param  {type} callback       User callback
 * @param  {type} preventInitial System variable to prevent initial callback
 * @return {type}
 */
var AsyncWatch = function(self, userPath, callback, instant) {

   if (typeof self !== 'object' || typeof callback !== 'function') {
      return;
   }

   var notation = dotNotation(userPath);
   if (!notation) {
      return;
   }
   callback.$id = callback.$id || fnIdCounter++;

   if (instant) {
      callback.$instant = true;
   }

   var original = notation.path;
   var originStringUserPath = notation.str;;
   callback.$path = originStringUserPath;
   // root (a.b.c.d -> gives a)
   var root = original[0];

   // Copy of original array
   var keys = [];
   for (var i = 0; i < original.length; i++) {
      keys.push(original[i])
   }

   // Descendants
   var descendantsArray = keys.splice(1, keys.length);
   var descendantsPath = descendantsArray.join('.');
   var $isSingleProperty = root === originStringUserPath
   var $config = self.$$p;
   var $id;

   if (!$config) {
      // Creating configration
      setHiddenProperty(self, '$$p', {});
      // Creating a service callback
      $config = self.$$p;
      setHiddenProperty($config, '$properties', {});
      setHiddenProperty($config, '$id', ++idCounter);
   }
   if ($id === undefined) {
      $id = $config.$id;
   }

   var $prop = $config.$properties[root];

   if (!$prop) {

      // $prop = setHiddenProperty($config.$properties, root, {});
      // $prop.$self = [];
      // $prop.$descendants = {};
      $prop = $config.$properties[root] = {
         $self: [],
         $descendants: {}
      }
      var current = self[root];
      Object.defineProperty(self, root, {
         get: function() {
            return current;
         },
         set: function(newValue) {
            onRootPropertySet(newValue, current);
            current = newValue;
            return current;
         }
      });

      // Triggers when a root has changed
      // Here we need to verify
      // if we have an explicit callback to fire ($self)
      // Notify descendants
      var onRootPropertySet = function(value, oldValue) {
         // Trigger Descendants
         for (var descendantKey in $prop.$descendants) {
            if ($prop.$descendants.hasOwnProperty(descendantKey)) {

               for (var i in $prop.$descendants[descendantKey].callbacks) {
                  // Job id has to have a callback index attached
                  var job_id = $id + descendantKey + i;
                  var descendantCallback = $prop.$descendants[descendantKey].callbacks[i];

                  AsyncTransaction.sign(descendantCallback, function() {
                     return [getPropertyValue(value, descendantKey), oldValue];
                  });
               }

               AsyncTransaction.add($id + descendantKey, function() {
                  $prop.$descendants[this.key].bindWatcher();
               }, {
                  key: descendantKey
               });
            }
         }
         if ($isSingleProperty) {
            // Trigger $self watchers
            for (var i = 0; i < $prop.$self.length; i++) {
               var _cb = $prop.$self[i];
               if (_cb.$path) { // handle old value propertly
                  if (typeof oldValue === "object") {
                     oldValue = getPropertyValue(oldValue, _cb.$path)
                  }
               }
               AsyncTransaction.sign(_cb, function() {
                  return [value, oldValue];
               })
            }
         }
      }
   }

   // If we are watching explicitly for the root variable
   if ($isSingleProperty) {

      // Job id has to have a callback index attached
      AsyncTransaction.sign(callback, function() {
         return [self[root]];
      });
      //CallbackArrayCollection()
      $prop.$self.push(callback);

   } else {
      // We need to watch descendants
      if (!$prop.$descendants[descendantsPath]) {
         $prop.$descendants[descendantsPath] = {
            callbacks: [callback],
            bindWatcher: function() {

               if (self.hasOwnProperty(root) && self[root] !== undefined) {
                  // we want NEW data only here.
                  // Initial callback has been triggered
                  AsyncWatch(self[root], descendantsArray, function(value, oldValue) {
                     for (var i = 0; i < $prop.$descendants[descendantsPath].callbacks.length; i++) {
                        var _cb = $prop.$descendants[descendantsPath].callbacks[i];

                        AsyncTransaction.sign(_cb, function() {
                           return [value, oldValue];
                        });
                     }
                  }, true); // We don't want to call another callback here
               }
            }
         }

         $prop.$descendants[descendantsPath].bindWatcher();
      } else {
         $prop.$descendants[descendantsPath].callbacks.push(callback);
      }

      AsyncTransaction.sign(callback, function() {
         return [getPropertyValue(self[root], descendantsArray)];
      });
   }
   var dArray = $prop.$descendants[descendantsPath];
   return {
      fn: callback,
      destroy: function() {
         if (dArray) {
            var dIndex = dArray.callbacks.indexOf(callback);
            if (dIndex > -1) {
               dArray.callbacks.splice(dIndex, 1);
            }
         }
         if ($prop.$self) {
            var sIndex = $prop.$self.indexOf(callback);
            if (sIndex > -1) {
               $prop.$self.splice(dIndex, 1);
            }
         }
      }
   }
}

var AsyncComputed = function(obj, prop, deps, fn) {
   var watchers = [];
   for (var i = 0; i < deps.length; i++) {
      var _local = deps[i];
      watchers.push(AsyncWatch(obj, _local, function() {}));
   }
   return Subscribe(watchers, function() {
      obj[prop] = fn.bind(obj)(obj);
   });
}

var AsyncWatchArray = function(self, userPath, callback, instant) {
   var events = [];
   return AsyncWatch(self, userPath, function(array, oldvalue) {
      if (!array.$$p) {
         array.$$p = p = setHiddenProperty(array, '$pp', {});
      }
      var $config = array.$$p.array;
      if (!$config) {
         $config = setHiddenProperty(p, 'array', {});
      }
      if (!$config.watchers) {
         $config.watchers = setHiddenProperty($config, 'fn', []);
      }
      $config.watchers.push(callback);

      // Initialize array (prototyping push splice)
      if (!$config.init) {
         $config.init = true;

         $config.changed = function(evt) {
            if (evt.length > 0) {
               for (var i = 0; i < $config.watchers.length; i++) {
                  $config.watchers[i](array, events);
               }
            }
            events = [];
         }

         array.push = function() {
            Array.prototype.push.apply(this, arguments);
            var args = arguments;
            events.push({
               name: "push",
               data: args
            });
            AsyncTransaction.sign($config.changed, function() {
               return [events];
            });
         }
         array.splice = function() {

            var args = arguments;
            Array.prototype.splice.apply(this, arguments);
            events.push({
               name: "splice",
               data: args
            });

            AsyncTransaction.sign($config.changed, function() {
               return [events];
            });
         }
         array.unshift = function() {
            var args = arguments;
            Array.prototype.unshift.apply(this, args);
            events.push({
               name: "unshift",
               data: args
            });
            AsyncTransaction.sign($config.changed, function() {
               return [events];
            });
         }
      }
      // reset events
      events = [];
      // initial run
      return callback(array, [{
         name: 'init'
      }]);
   }, instant);
}

AsyncWatch.subscribe = Subscribe;
AsyncWatch.computed = AsyncComputed;
module.exports.AsyncWatch = AsyncWatch;
module.exports.AsyncSubscribe = Subscribe;
module.exports.AsyncComputed = AsyncComputed;
module.exports.AsyncWatchArray = AsyncWatchArray;
module.exports.AsyncTransaction = AsyncTransaction;
