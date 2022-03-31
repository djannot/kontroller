function escape_html(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

function load_json(text) {
    editor.update(text);
}

function fullscreen(element) {
    element_moved = element;
    console.log(element_moved);
    var largeModal = new bootstrap.Modal(document.getElementById('largeModal'));
    largeModal.show();
    $("#largeModalBody").empty();
    $(element).siblings().appendTo("#largeModalBody");
}

function format_json(str) {
    let res = JSON.stringify(str, null, 2);
    if (res === undefined) {
        res = "";
    }
    return res;
}

var editor;
var tmp;

$('document').ready(function(){
    //Define variables for input elements
    var fieldEl = document.getElementById("filter-field");
    var typeEl = document.getElementById("filter-type");
    var valueEl = document.getElementById("filter-value");

    //Custom filter example
    function customFilter(data){
        return data.car && data.rating < 3;
    }

    //Trigger setFilter function with correct parameters
    function updateFilter(){
    var filterVal = fieldEl.options[fieldEl.selectedIndex].value;
    var typeVal = typeEl.options[typeEl.selectedIndex].value;

    var filter = filterVal == "function" ? customFilter : filterVal;

    if(filterVal == "function" ){
        typeEl.disabled = true;
        valueEl.disabled = true;
    }else{
        typeEl.disabled = false;
        valueEl.disabled = false;
    }

    if(filterVal){
        table.setFilter(filter,typeVal, valueEl.value);
    }
    }

    //Update filters on value change
    document.getElementById("filter-field").addEventListener("change", updateFilter);
    document.getElementById("filter-type").addEventListener("change", updateFilter);
    document.getElementById("filter-value").addEventListener("keyup", updateFilter);

    //Clear filters on "Clear Filters" button click
    document.getElementById("filter-clear").addEventListener("click", function(){
    fieldEl.value = "";
    typeEl.value = "=";
    valueEl.value = "";

    table.clearFilter();
    });

    new ClipboardJS('.btn');
    // create the editor
    /*
    const container = document.getElementById("json");
    const options = {
        mode: 'tree'
    };
    editor = new JSONEditor(container, options);
    */

    ace.config.set('basePath', '/js/src');
    editor = ace.edit('editor', {
        mode: "ace/mode/yaml",
        selectionStyle: "text"
    })

    const inputElement = document.getElementById("inputElement");

    const socket = new WebSocket('ws://' + window.location.host);

    // Connection opened
    socket.addEventListener('open', function (event) {
        socket.send('Hello Server!');
    });

    let rows = 20;
    let data = [];
    for(i=0; i<rows; i++) {
        data.push({});
    }

    var table = new Tabulator("#table", {
        data: data,
        layout: "fitColumns",
        pagination: "local",
        paginationSize: rows,
        columns:[
            {title:"Timestamp", field:"ts", formatter:"datetime", formatterParams: {inputFormat: "yyyy-MM-dd HH:mm:ss"}, headerFilter:"input"},
            {title:"Type", field:"type", formatter:"plaintext", headerFilter:"input"},
            {title:"ApiVersion", field:"apiObj.apiVersion", formatter:"plaintext", headerFilter:"input"},
            {title:"Kind", field:"apiObj.kind", formatter:"plaintext", headerFilter:"input"},
            {title:"Namespace", field:"apiObj.metadata.namespace", formatter:"plaintext", headerFilter:"input"},
            {title:"Name", field:"apiObj.metadata.name", formatter:"plaintext", headerFilter:"input"},
            //{title:"Object", field:"formattedObject", formatter:"html", headerFilter:"input"},
        ]
    })
    
    table.on("tableBuilt", function(){
        table.setSort([
            {column:"ts", dir:"desc"},
        ]);
    });

    table.on("rowClick", function(e, row){
        //e - the click event object
        //row - row component
        //console.log(row);
        tmp = row;
        //editor.set(row.getData().apiObj);
        //editor.setValue(row.getData().apiObj);
        editor.setValue(jsyaml.dump(row.getData().apiObj));
        editor.selection.clearSelection();
        //editor.resize();
    });

    // Listen for messages

    start = Date.now();

    socket.addEventListener('message', function (event) {
        //console.log(JSON.parse(event.data));
        let data = JSON.parse(event.data);
        if(new Date(data.ts) - start > 1000) {
            data.ts = luxon.DateTime.fromMillis(data.ts).toFormat('yyyy-MM-dd HH:mm:ss');
            data.formattedObject = "<pre>" + format_json(data.apiObj) + "</pre>";
            table.addData([data]);
        }
    });


    // Move back the component from the full screen
    var largeModal = document.getElementById('largeModal');
    largeModal.addEventListener('hide.bs.modal', function (event) {
        $("#largeModalBody").children().appendTo($(element_moved).parent());
    });
});