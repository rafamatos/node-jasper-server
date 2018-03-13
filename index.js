/*
Jasper Server for NodeJS
(c) 2018 Loable Technologies
Andrew M. Loable
https://loable.tech
*/
const java = require('java');
const fs = require('fs');
const path = require('path');
const util = require('util');
const tmp = require('tmp');
const sleep = require('sleep');
const async = require('async');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const vm = this;

vm.modulePath = path.dirname(__filename); // main directory
vm.libraryPath = path.join(vm.modulePath, 'libs'); // Put jars in lib directory

vm.settings = {
    reports: {},
    drivers: {},
    connections: {}
};

// Add jar to java classpath
function loadJar(file){
    if (path.extname(file) == '.jar'){
        console.log("Loading: " + file);
        java.classpath.push(file);
    }
}

// Import JasperReports
function importJasperReports(){

};

// Returns the connection identified by the report
function getReportConnection(report){
    var conn = vm.settings.connections[report.connection];
    console.log(conn);
    if (conn){
        // Return Jasper Connection
        return vm.driverManager.getConnectionSync(conn.jdbc, conn.user, conn.password);
    } else {
        console.error("Connection " + report.connection + " is not registered.");
        // Return Empty Data Source
        return new vm.jasperEmptyDataSource();
    }
};

// Parse Locale String
function parseLocaleString(str){
    var s = str.split(/[_|-]/);
    if (s.length > 1){
        return vm.locale(s[0], s[1]);
    } else {
        return vm.locale(s[0]);
    }
};

// Compile jrxml to jasper
function compileJRXML(jrxml, jasper){
    jrxml = path.join(vm.modulePath, jrxml);
    java.callStaticMethodSync("net.sf.jasperreports.engine.JasperCompileManager", "compileReportToFile", jrxml, jasper);
    return jasper;
};

// Generate PDF from a report and return file stream
function generatePDF(report){
    var tmpFile = tmp.fileSync();
    var jasperFile = tmpFile.name + ".jasper";
    var pdfFile = tmpFile.name + ".pdf";

    console.log("check registered reports");
    for (var r in vm.settings.reports){
        if (report.name === r){
            report.jrxml = vm.settings.reports[r].jrxml;
        }
    }

    if (report.jrxml){
        report.jasper = compileJRXML(report.jrxml, jasperFile);
    } else {
        console.error("jrxml not defined in report object");
    }

    var toExports = [];

    if (report.jasper){
        var parameters = null;
        var toExport = null;
        // If report object has parameters
        if (report.parameters){
            parameters = new vm.hashMap();
            for(var p in report.parameters){
                if (p === "REPORT_LOCALE"){
                    report.parameters[p] = parseLocaleString(report.parameters[p]);
                }
                parameters.putSync(p, report.parameters[p]);
            }
        }

        // Get connection used by report
        var connection = getReportConnection(report);
        var toExport = vm.jasperFillManager.fillReportSync(jasperFile, parameters, connection);
        vm.jasperExportManager['exportReportToPdfFileSync'](toExport, pdfFile);
        var toStream = fs.readFileSync(pdfFile);
        fs.unlinkSync(pdfFile);
        fs.unlinkSync(jasperFile);
        return toStream;     
    } else {
        console.error("jasper not generated by previous process");
    }

    return '';
};

// Start Of Process

async.auto({
    getSettings: function(callback){
        console.log("get settings");
        vm.settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
        callback();
    },
    getJarsFromLib: ['getSettings', function(results, callback){
        var dir = vm.libraryPath;
        console.log("get jars from " + dir);
        var files = fs.readdirSync(dir);
        for (var file in files){
            file = path.join(dir, files[file]);
            var stat = fs.statSync(file);
            if (stat && stat.isDirectory()){
                // directory found, do not process
                console.log("found subdirectory " + file);
            } else {
                console.log("found file " + file);
                // Load Jar
                loadJar(file);
            }
        }       
        callback();
    }],
    loadSQLDrivers: ['getJarsFromLib', function(results, callback){    
        console.log("load sql drivers");
        var classLoader = java.callStaticMethodSync("java.lang.ClassLoader", "getSystemClassLoader");
        if (vm.settings.drivers){
            for (var name in vm.settings.drivers){
                var driver = vm.settings.drivers[name];            
                var file = path.join(vm.modulePath, driver.path);
                loadJar(file);
                classLoader.loadClassSync(driver.class).newInstanceSync();
            }        
        }
        callback();
    }],
    importJasper: ['loadSQLDrivers', function(results, callback){
        console.log("import jasper");        
        vm.driverManager = java.import("java.sql.DriverManager");
        vm.hashMap = java.import("java.util.HashMap");
        vm.locale = java.import("java.util.Locale");
        vm.byteAraryInputStream = java.import("java.io.ByteArrayInputStream");
        vm.jasperEmptyDataSource = java.import("net.sf.jasperreports.engine.JREmptyDataSource");
        vm.jasperCompileManager = java.import("net.sf.jasperreports.engine.JasperCompileManager");
        vm.jasperFillManager = java.import("net.sf.jasperreports.engine.JasperFillManager");
        vm.jasperExportManager = java.import("net.sf.jasperreports.engine.JasperExportManager");
        callback();
    }]
},
function(error, results) {
    console.log("start express");
    // Start of Express     
    app.use(cors({ origin: true }));
    app.use(bodyParser.json());

    app.post("/generate_pdf", function(req, res){
        var report = req.body;
        if (report){
            console.log(report);
            var pdf = generatePDF(report);
            res.contentType("application/pdf");
            res.send(pdf);
            return;
        } else {
            res.status(400).send("invalid parameters");
        }
        
    });
    console.log("Listening at port 3000");
    app.listen(3000, 'localhost');  
});




