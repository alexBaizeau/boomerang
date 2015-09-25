/*eslint-env mocha*/
/*global _*/

//
// BOOMR.plugins.TestFramework
//
(function(window) {

	// set our namespace
	var BOOMR = window.BOOMR = window.BOOMR || {};
	BOOMR.plugins = BOOMR.plugins || {};
	if (BOOMR.plugins.TestFramework) {
		return;
	}

	BOOMR.plugins.TestFramework = {
		initialized: false,
		fired_page_ready: false,
		fired_onbeacon: false,
		fired_before_unload: false,
		beacons: [],
		page_ready: function() {
			this.fired_page_ready = true;
		},
		onbeacon: function(data) {
			this.beacons.push(_.clone(data));
			this.fired_onbeacon = true;
		},
		lastBeacon: function() {
			if (this.beacons.length === 0) {
				return false;
			}

			return this.beacons[this.beacons.length - 1];
		},
		beaconCount: function() {
			return this.beacons.length;
		},
		before_unload: function() {
			this.fired_before_unload = true;
		},
		init: function() {
			if (this.initialized) {
				return this;
			}

			BOOMR.subscribe("page_ready", this.page_ready, null, this);
			BOOMR.subscribe("onbeacon", this.onbeacon, null, this);
			BOOMR.subscribe("before_unload", this.before_unload, null, this);

			this.initialized = true;

			return this;
		},
		is_complete: function() {
			return true;

		}
	};
})(window);

//
// BOOMR_test
//
(function(window) {
	"use strict";

	var t = {};

	var complete = false;
	var initialized = false;
	var testFailures = [];
	var testPasses = [];

	var beaconsSeen = 0;

	// test framework
	var assert;

	//
	// Constants
	//
	t.BEACON_URL = "/blackhole";
	t.MAX_RESOURCE_WAIT = 500;

	//
	// Exports
	//
	t.templates = {};
	t.isComplete = function() {
		return complete;
	};

	t.isInitialized = function() {
		return initialized;
	};

	t.getTestFailures = function() {
		return complete ? testFailures : [];
	};

	t.getTestFailureMessages = function() {
		if (!complete) {
			return [];
		}

		var messages = [];
		for (var i = 0; i < testFailures.length; i++) {
			messages.push({
				title: testFailures[i].titles,
				name: testFailures[i].name,
				message: testFailures[i].message
			});
		}

		return messages;
	};

	t.getTestPasses = function() {
		return complete ? testPasses: [];
	};

	t.CONFIG_DEFAULTS = {
		beacon_url: t.BEACON_URL,
		ResourceTiming: {
			enabled: false
		}
	};

	t.flattenTestTitles = function(test) {
		var titles = [];
		while (test.parent.title) {
			titles.push(test.parent.title);
			test = test.parent;
		}
		return titles.reverse();
	};

	t.runTests = function() {
		var runner = window.mocha.run();

		runner.on("pass", function(test){
			testPasses.push({
				test: test
			});
		})
		.on("fail", function(test, err){
			testFailures.push({
				name: test.title,
				result: false,
				message: err.message,
				// stack: err.stack,
				titles: t.flattenTestTitles(test)
			});
		})
		.on("end", function() {
			complete = true;

			// for saucelabs-mocha
			window.mochaResults = runner.stats;
			window.mochaResults.reports = testFailures;

			// convenient way for selenium to wait
			var competeDiv = document.createElement("div");
			competeDiv.id = "BOOMR_test_complete";
			document.body.appendChild(competeDiv);
		});
	};

	t.init = function(config) {
		if (initialized) {
			return;
		}

		if (!window.BOOMR || !window.BOOMR.version) {
			if (window.document.addEventListener) {
				window.document.addEventListener("onBoomerangLoaded", function() {
					t.init(config);
				});
			}
			else if (window.document.attachEvent) {
				document.attachEvent("onpropertychange", function(e) {
					e = e || window.event;
					if (e && e.propertyName === "onBoomerangLoaded") {
						t.init(config);
					}
				});
			}

			return;
		}

		config = _.merge({}, t.CONFIG_DEFAULTS, config);

		// initialize boomerang
		BOOMR.init(config);

		if (config.onBoomerangLoaded) {
			config.onBoomerangLoaded();
		}

		if (config.afterFirstBeacon) {
			var xhrSent = false;
			BOOMR.subscribe(
				"onbeacon",
				function() {
					if (xhrSent) {
						return;
					}
					xhrSent = true;

					config.afterFirstBeacon();
				});
		}

		// fake session details so beacons send
		BOOMR.addVar({
			"h.key": "aaaaa-bbbbb-ccccc-ddddd-eeeee",
			"h.d": "localhost",
			"h.t": new Date().getTime(),
			"h.cr": "abc"
		});

		// setup Mocha
		window.mocha.globals(["BOOMR", "PageGroupVariable", "mochaResults", "gloabl_test_results"]);
		window.mocha.checkLeaks();

		// set globals
		assert = window.assert = window.chai.assert;

		if (config.testAfterOnBeacon) {
			// default to waiting until one beacon was sent, otherwise use
			// the number passed in
			if (typeof config.testAfterOnBeacon !== "number") {
				config.testAfterOnBeacon = 1;
			}

			BOOMR.subscribe("onbeacon", function() {
				if (++beaconsSeen === config.testAfterOnBeacon) {
					// wait a few more ms so the beacon fires
					// TODO: Trim this timing down if we can make it more reliable
					setTimeout(t.runTests, 1000);
				}
			});
		}
		else {
			BOOMR.setImmediate(t.runTests);
		}

		initialized = true;
	};

	t.findResourceTimingBeacon = function() {
		if (!t.isResourceTimingSupported()) {
			return null;
		}

		var entries = BOOMR.window.performance.getEntriesByType("resource");
		for (var i = 0; i < entries.length; i++) {
			var e = entries[i];
			if (e.name && e.name.indexOf(t.BEACON_URL) !== -1) {
				return e;
			}
		}

		return null;
	};

	t.isResourceTimingSupported = function() {
		return (window.performance && typeof window.performance.getEntriesByType === "function");
	};

	t.isQuerySelectorSupported = function() {
		return typeof window.document.querySelector === "function";
	};

	t.isNavigationTimingSupported = function() {
		return typeof BOOMR.plugins.RT.navigationStart() !== "undefined";
	};

	t.isUserTimingSupported = function() {
		return (window.performance &&
		        typeof window.performance.getEntriesByType === "function" &&
		        typeof window.performance.mark === "function" &&
		        typeof window.performance.measure === "function");
	};

	t.validateBeaconWasImg = function(done) {
		// look for #beacon_form in the BOOMR window's IFRAME
		var form = BOOMR.boomerang_frame ? BOOMR.boomerang_frame.document.getElementById("beacon_form") : null;
		assert.isNull(form);

		if (!t.isResourceTimingSupported()) {
			// can't also validate via RT
			return done();
		}

		done();
	};

	t.validateBeaconWasForm = function(done) {
		// look for #beacon_form in the BOOMR window's IFRAME
		var form = BOOMR.boomerang_frame ? BOOMR.boomerang_frame.document.getElementById("beacon_form") : null;
		assert.isNotNull(form);
		assert.equal(form.enctype, "application/x-www-form-urlencoded");
		assert.include(form.action, t.BEACON_URL);

		done();
	};

	t.validateBeaconWasSent = function(done) {
		var tf = BOOMR.plugins.TestFramework;

		assert.isTrue(tf.fired_onbeacon, "ensure we fired a beacon ('onbeacon')");

		assert.isObject(tf.lastBeacon(), "ensure the data was sent to 'onbeacon'");

		assert.isString(tf.lastBeacon().v, "ensure the beacon has basic properties");

		done();
	};

	t.canSetCookies = function() {
		var testCookieName = "test_cookie";

		// set a cookie
		document.cookie = [testCookieName + "=true", "path=/", "domain=" + location.hostname].join("; ");

		// determine if it was set OK
		return (" " + document.cookie + ";").indexOf(" " + testCookieName + "=") !== -1;
	};

	t.parseTimers = function(timers) {
		var timerValues = {};

		var timersSplit = timers.split(",");
		for (var i = 0; i < timersSplit.length; i++) {
			var timerSplit = timersSplit[i].split("|");
			timerValues[timerSplit[0]] = timerSplit[1];
		}

		return timerValues;
	};

	/**
	* Finds the first load of the specified resource.
	* @param {string} url Partial URL match
	* @return {PerformanceResourceTiming} Last resource to load for that URL
	*/
	t.findFirstResource = function(url) {
		if ("performance" in window &&
			window.performance &&
			window.performance.getEntriesByType) {
			var entries = window.performance.getEntriesByType("resource");

			for (var i = 0; i < entries.length; i++) {
				if (entries[i].name.indexOf(url) !== -1) {
					return entries[i];
				}
			}
		}

		return null;
	};

	/**
	* Finds the last load of the specified resource.
	* @param {string} url Partial URL match
	* @return {PerformanceResourceTiming} Last resource to load for that URL
	*/
	t.findLastResource = function(url) {
		if ("performance" in window &&
			window.performance &&
			window.performance.getEntriesByType) {
			var entries = window.performance.getEntriesByType("resource");

			var res = null;
			for (var i = 0; i < entries.length; i++) {
				if (entries[i].name.indexOf(url) !== -1) {
					if (res === null || entries[i].responseEnd > res.responseEnd) {
						res = entries[i];
					}
				}
			}

			return res;
		}
		else {
			return null;
		}
	};

	/**
	* Finds the nth load of the specified resource.
	* @param {string} url Partial URL match
	* @param {number} n Nth resource
	* @return {PerformanceResourceTiming} Last resource to load for that URL
	*/
	t.findNthResource = function(url, n) {
		if ("performance" in window &&
			window.performance &&
			window.performance.getEntriesByType) {
			var entries = window.performance.getEntriesByType("resource");
			var res = null;
			var matches = 0;

			for (var i = 0; i < entries.length; i++) {
				if (entries[i].name.indexOf(url) !== -1) {
					if (res === null || entries[i].responseEnd > res.responseEnd) {
						if (matches === n) {
							res = entries[i];
							break;
						}

						matches++;
					}
				}
			}

			return res;
		}
		else {
			return null;
		}
	};

	/**
	 * Validates the beacon was sent with a load time equal to when the specified resource
	 * loaded.
	 *
	 * @param {number} beaconIndex Which beacon
	 * @param {string} urlMatch URL to match
	 * @param {number} closeTo Range that the load time can be off by
	 * @param {number} fallbackMin If RT is not supported, the minimum time
	 * @param {number} fallbackMax If RT is not supported, the maximum time
	 * @param {boolean|number} useLastMatch Use the last match of the resource instead of the first, or, if a number, that resource
	 * @param {number} n Check the nth resource
	 */
	t.validateBeaconWasSentAfter = function(beaconIndex, urlMatch, closeTo, fallbackMin, fallbackMax, useLastMatch) {
		var tf = BOOMR.plugins.TestFramework;

		var res;
		if (typeof useLastMatch === "number") {
			res = t.findNthResource(urlMatch, useLastMatch);
		}
		else {
			res = useLastMatch ? t.findLastResource(urlMatch) : t.findFirstResource(urlMatch);
		}

		if (res != null) {
			assert.closeTo(tf.beacons[beaconIndex].t_done, res.responseEnd, closeTo);
		}
		else {
			// we don't have ResourceTiming, use the fallback times
			assert.operator(tf.beacons[beaconIndex].t_done, ">=", fallbackMin);
			assert.operator(tf.beacons[beaconIndex].t_done, "<=", fallbackMax);
		}
	};

	/**
	 * Ensures the number of beacons specified were sent.
	 *
	 * Also waits a second after the beacon count was hit to ensure no additional
	 * beacons were sent.
	 *
	 * @param {function} done Callback
	 * @param {number} beaconCount Expected beacon count
	 */
	t.ensureBeaconCount = function(done, beaconCount) {
		function compareBeaconCount() {
			return BOOMR.plugins.TestFramework.beaconCount() === beaconCount;
		}
		function testBeaconCount() {
			if (compareBeaconCount()) {
				setTimeout(
					function() {
						done(compareBeaconCount() ? undefined : new Error("beaconCount: " + BOOMR.plugins.TestFramework.beaconCount() + " !== " + beaconCount));
					}, 1000);
			}
			else {
				setTimeout(testBeaconCount, 100);
			}
		}

		testBeaconCount();
	};

	/**
	 * Runs the specified callback if AutoXHR is enabled
	 *
	 * @param {function} done Test done callback
	 * @param {function} testXhr Test to run if AutoXHR is enabled
	 * @param {function} testDegenerate Test if AutoXHR is not enabled
	 */
	t.ifAutoXHR = function(done, testXhr, testDegenerate) {
		if (BOOMR.plugins.AutoXHR) {
			return (testXhr || done || function(){})();
		}
		(testDegenerate || done || function(){})();
	};


	/**
	 * Determines how many elements on the page match the attribute
	 *
	 * @param {string} tagName Tag name
	 * @param {string} attr Attribute name
	 * @param {RegEx} regex Regular expression matching the attribute
	 * @returns {number} Number of elements matching
	 */
	t.elementsWithAttribute = function(tagName, attr, regex) {
		var nodes = document.getElementsByTagName("script");

		var matching = 0;

		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			if (node[attr] && node[attr].match(regex)) {
				matching++;
			}
		}

		return matching;
	};

	/**
	 * Runs a function repeatedly the specified number of times with the
	 * specified delay.
	 *
	 * @param {function} run Function to run
	 * @param {number} times How many times to run it
	 * @param {number} delay How often to delay between runs
	 * @param {function} done What to run when done
	 */
	t.runRepeatedly = function(run, times, delay, done) {
		var runTimes = 0;

		function repeat() {
			if (++runTimes === times) {
				return done();
			}

			run();

			setTimeout(repeat, delay);
		}

		repeat();
	};

	/**
	 * Shows a countdown clock on the page
	 *
	 * @param {Object} test Mocha test case
	 * @param {number} maxTime Maximum timeout
	 * @param {number} expectedTime How many expected seconds
	 *
	 * @returns {string} Timer ID you can use to clearTimeout later
	 */
	t.timeout = function(test, maxTime, expectedTime) {
		test.timeout(maxTime);

		var stats = document.getElementById("mocha-stats");

		var el = document.createElement("li");

		stats.appendChild(el);

		var startTime = +(new Date());
		var endTimeExpected = startTime + expectedTime;
		var endTimeMax = startTime + maxTime;

		var timerID = setInterval(function(){
			var now = +(new Date());
			if (now > endTimeMax) {
				clearInterval(timerID);

				el.parentNode.removeChild(el);

				return;
			}
			else if (now > endTimeExpected) {
				el.style["font-color"] = "red";
			}

			var timeLeft = endTimeMax - now;

			el.innerHTML = "timeout: <em>" + (Math.floor(timeLeft / 100) / 10).toFixed(1) + "</em>s";
		}, 100);

		el.id = "mocha-timer" + timerID;

		return timerID;
	};

	/**
	 * Clears a previously set timer ID
	 *
	 * @param {string} timerID TimerID
	 */
	t.clearTimeout = function(timerID) {
		clearInterval(timerID);

		var el = document.getElementById("mocha-timer" + timerID);
		if (el) {
			el.parentNode.removeChild(el);
		}
	};

	window.BOOMR_test = t;

}(window));