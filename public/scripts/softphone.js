// Page loaded
$(function() {

  // ** Application container ** //
  window.SP = {}

  // Global state
  SP.state = {};
  SP.state.callNumber = null;
  SP.username = "default_client";

  SP.functions = {};

  SP.functions.getSFDCUserInfo = function () {
    var callback = function (response) {
      console.log('response', response);
      if (response.result) {
        console.log("result = " + response.result);
        var useresult = response.result;
        useresult = useresult.replace("@", "AT");
        useresult = useresult.replace(".", "DOT");
        SP.username = useresult;

      } else {
        console.log("error = " + response.error);
      }

      //TODO: need a way to get here when not inside Salesforce - this is only called in the runApex callback.
      $.get("/token", {"client":SP.username}, function (token) {
        //alert("got token=" + token);
        Twilio.Device.setup(token, {debug: true});
      });

      SP.functions.startWebSocket();
    };

    //how  can we tell if sforce works before calling this?
    sforce.interaction.runApex('UserInfo', 'getUserId', '' ,callback);
  }

  //1. run sfdc code
  // ** UI Widgets ** //

  // Hook up numpad to input field
  $("div.number").bind('click',function(){
    $("#number-entry > input").val($("#number-entry > input").val()+$(this).attr('Value'));
  });

  // Hide caller info
  SP.functions.hideCallData = function() {
    $("#call-data").hide();
  }
  SP.functions.hideCallData();

  // Show caller info
  SP.functions.showCallData = function(callData) {
    $("#call-data > ul").hide();
    $(".caller-name").text(callData.callerName);
    $(".caller-number").text(callData.callerNumber);
    $(".caller-queue").text(callData.callerQueue);
    $(".caller-message").text(callData.callerMessage);

    if (callData.callerName) {
      $("#call-data > ul.name").show();
    }

    if (callData.callerNumber) {
      $("#call-data > ul.phone_number").show();
    }

    if (callData.callerQueue) {
      $("#call-data > ul.queue").show();
    }

    if (callData.callerMessage) {
      $("#call-data > ul.message").show();
    }

    $("#call-data").slideDown(400);
  }

  // Attach answer button to an incoming connection object
  SP.functions.attachAnswerButton = function(conn) {
    $("#action-buttons > button.answer").click(function() {
      conn.accept();
    }).removeClass('inactive').addClass("active");
  }

  SP.functions.detachAnswerButton = function() {
    $("#action-buttons > button.answer").unbind().removeClass('active').addClass("inactive");
  }

  SP.functions.updateAgentStatusText = function(statusCategory, statusText) {

    if (statusCategory == "ready") {
         $("#agent-status").removeClass();
         $("#agent-status").addClass("ready");
     }

    if (statusCategory == "notReady") {
         $("#agent-status").removeClass();
         $("#agent-status").addClass("not-ready");
    }

    if (statusCategory == "onCall") {
        $("#agent-status").removeClass();
        $("#agent-status").addClass("on-call");
    }

    $("#agent-status > p").text(statusText);
  }

  // Call button will make an outbound call (click to dial) to the number entered
  $("#action-buttons > button.call").click( function( ) {
    params = {"PhoneNumber": $("#number-entry > input").val()};
    Twilio.Device.connect(params);
  });

  // Hang up button will hang up any active calls
  $("#action-buttons > button.hangup").click( function( ) {
    Twilio.Device.disconnectAll();
  });

  // Wire the ready / not ready buttons up to the server-side status change functions
  $("#agent-status-controls > button.ready").click( function( ) {
    SP.functions.ready();
  });

  $("#agent-status-controls > button.not-ready").click( function( ) {
    SP.functions.notReady();
  });

    $("#agent-status-controls > button.userinfo").click( function( ) {
    SP.functions.getSFDCUserInfo();
  });

  // ** Twilio Client Stuff ** //

  // get username, generate token, set up device with token. callbacks bitch.
  SP.functions.getSFDCUserInfo();

  Twilio.Device.ready(function (device) {
    sforce.interaction.cti.enableClickToDial();
    sforce.interaction.cti.onClickToDial(startCall);
    SP.functions.ready();
  });

  Twilio.Device.offline(function (device) {
    //make a new status call.. something like.. disconnected instead of notReady ?
    sforce.interaction.cti.disableClickToDial();
    SP.functions.notReady();
    SP.functions.hideCallData();
  });


  /* Report any errors on the screen */
  Twilio.Device.error(function (error) {
    SP.functions.updateAgentStatusText("ready", error.message);
    SP.functions.hideCallData();
  });

  /* Log a message when a call disconnects. */
  Twilio.Device.disconnect(function (conn) {
    SP.functions.updateAgentStatusText("ready", "Call ended");

    sforce.interaction.getPageInfo(saveLog);

    SP.state.callNumber = null;

    // deactivate answer button
    SP.functions.detachAnswerButton();

    // return to waiting state
    SP.functions.hideCallData();
    SP.functions.ready();
  });

  Twilio.Device.connect(function (conn) {
    console.dir(conn);
    var  status = "";

    var callNum = null;
    if (conn.parameters.From) {
      callNum = conn.parameters.From;
      status = "Call From: " + callNum;
    } else {
      status = "Outbound call";

    }

    SP.functions.updateAgentStatusText("onCall", status);
    SP.functions.detachAnswerButton();

    //send status info
    $.get("/track", { "from":SP.username, "status":"OnCall" }, function(data) {

    });
  });

  /* Listen for incoming connections */
  Twilio.Device.incoming(function (conn) {

    // Update agent status
    sforce.interaction.setVisible(true);  //pop up CTI console
    SP.functions.updateAgentStatusText("ready", ("Call from: " + conn.parameters.From))
    // Enable answer button and attach to incoming call
    SP.functions.attachAnswerButton(conn);


    var inboundnum = cleanInboundTwilioNumber(conn.parameters.From);
    var sid = conn.parameters.CallSid
    var result = "";

    $.get("/calldata", { "CallSid":sid}, function(data) {
      result = JSON.parse(data);
      result.caller

      callData = {}
      callData.callerName = result.requestor_name;
      callData.callerNumber = conn.parameters.From;
      callData.callerQueue = result.queue_name;
      callData.callerMessage = result.message;
      SP.functions.showCallData(callData);
      var name = result.requestor_name  || "";

      sforce.interaction.searchAndScreenPop(inboundnum, 'con10=' + inboundnum + '&con12=' + inboundnum + '&name_firstcon2=' + name,'inbound');
    });
  });

  Twilio.Device.cancel(function(conn) {
      console.log(conn.parameters.From); // who canceled the call
      SP.functions.detachAnswerButton();
      SP.functions.hideCallData();
      SP.functions.notReady();
  });

  SP.functions.startWebSocket = function() {
    // ** Agent Presence Stuff ** //
    console.log(".startWebSocket...");
   var wsaddress = 'ws://' + window.location.host  + "/websocket?clientname=" + SP.username

   var ws = new WebSocket(wsaddress);
    ws.onopen    = function()  { console.log('websocket opened'); };
    ws.onclose   = function()  { console.log('websocket closed'); }
    ws.onmessage = function(m) {
      //console.log('websocket message: ' +  m.data);

      var result = JSON.parse(m.data);

      $("#team-status > .queues-status").text("Call Queue:  " + result.queuesize);
      $("#team-status > .agents-status").text("Ready Agents:  " + result.readyagents);
    };
  }

  // Set server-side status to ready / not-ready
  SP.functions.notReady = function() {
    $.get("/track", { "from":SP.username, "status":"NotReady" }, function(data) {
      SP.functions.updateStatus();
    });
  }

  SP.functions.ready = function() {
    $.get("/track", { "from":SP.username, "status":"Ready" }, function(data) {
        SP.functions.updateStatus();
    });
  }


  // Check the status on the server and update the agent status dialog accordingly
  SP.functions.updateStatus = function() {
    $.get("/status", { "from":SP.username}, function(data) {

      if (data == "NotReady") {
           SP.functions.updateAgentStatusText("notReady", "Not Ready")
       }

      if (data == "Ready") {
           SP.functions.updateAgentStatusText("ready", "Ready")
       }
    });

  }

  /******** GENERAL FUNCTIONS for SFDC  ***********************/

  function cleanInboundTwilioNumber(number) {
    //twilio inabound calls are passed with +1 (number). SFDC only stores
    return number.replace('+1','');
  }

  function cleanFormatting(number) {
    //changes a SFDC formatted US number, which would be 415-555-1212
    return number.replace(' ','').replace('-','').replace('(','').replace(')','').replace('+','');
  }

  function startCall(response) {
    //called onClick2dial
    sforce.interaction.setVisible(true);  //pop up CTI console
    var result = JSON.parse(response.result);
    var cleanednumber = cleanFormatting(result.number);

    //alert("cleanednumber = " + cleanednumber);
    params = {"PhoneNumber": cleanednumber};
    Twilio.Device.connect(params);
  }

  function saveLog(response) {
    console.log("saving log result, response:");
    var result = JSON.parse(response.result);

    console.log(response.result);

    var timeStamp = new Date().toString();
    timeStamp = timeStamp.substring(0, timeStamp.lastIndexOf(':') + 3);
    var currentDate = new Date();
    var currentDay = currentDate.getDate();
    var currentMonth = currentDate.getMonth()+1;
    var currentYear = currentDate.getFullYear();
    var dueDate = currentYear + '-' + currentMonth + '-' + currentDay;
    var saveParams = 'Subject=' + 'Call on ' + timeStamp;

    saveParams += '&Status=completed';
    saveParams += '&CallType=' + 'Inbound';
    saveParams += '&Activitydate=' + dueDate;
    saveParams += '&CallObject=' + currentDate.getTime();
    saveParams += '&Phone=' + SP.state.callNumber;  //we need to get this from.. somewhere
    saveParams += '&Description=' + "test description";

    console.log("About to parse  result..");

    var result = JSON.parse(response.result);
    if(result.objectId.substr(0,3) == '003') {
        saveParams += '&whoId=' + result.objectId;
    } else {
        saveParams += '&whatId=' + result.objectId;
    }

    console.log("save params = " + saveParams);
    sforce.interaction.saveLog('Task', saveParams);
  }
});