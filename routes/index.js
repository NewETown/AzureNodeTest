var express = require('express');
var router = express.Router();
var multiparty = require('multiparty');
var azureStorage = require('azure-storage');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/upload', function(req, res, next) {
    var form = new multiparty.Form();
    
    form.on('part', function(part) {
        if(!part.filename) {
            console.log('No part.filename');
            return;
        }
        
        var size = part.byteCount;
        var name = part.filename;
        var mimeType = part.headers['content-type'];
        
        azureMedia.rest.asset.create({Name: name}, function(err, asset) {
            if (err) {
                console.log(err);
            } else {
                console.log('Created asset');
                asset.MimeType = mimeType;
                asset.Size = size;
                asset.Part = part;
                asset.AssetId = asset.Id;
                buildAssetFile(asset);
            }
        });
        
        part.on('error', function(err) {
            var code = err.statusCode || 500;
            res.status(code).send('Error in PART!');
        });
        
    });
    
    form.on('error', function(err) {
        console.log('form.on ERROR!');
        var code = err.statusCode || 500;
        res.status(code).send('form.on ERROR!');
    });
    
    form.on('close', function() {
        res.status(200).send('Successful upload!');
    });
    
    form.parse(req);
    
    // res.send('Done with something');

});

function buildAssetFile(data) {
    var parentAssetId = data.Id;
    var name = data.Name;
    
    var assetData = {
        ParentAssetId: data.AssetId,
        IsEncrypted: "false",
        IsPrimary: "false",
        MimeType: data.MimeType,
        Name: data.Name
    };
    
    azureMedia.rest.assetfile.create(assetData, function(err, assetfile) {
        if (err) {
            console.log(err);
        } else {
            console.log('Created Asset File');
            var assetFileData = {
                DurationInMinutes: 70,
                Permissions: 2,
                Name: "TempWritePolicy",
                AssetId: data.Id,
                FileName: name,
                Size: data.Size,
                Part: data.Part,
                AssetFileId: assetfile.Id,
                MimeType: data.MimeType
            };
            
            buildAccessPolicy(assetFileData);
        }
    });
}

function buildAccessPolicy(data) {
    
    azureMedia.rest.accesspolicy.findOrCreate(data.DurationInMinutes, data.Permissions, function(err, accesspolicy_model) {
        if (err) {
            console.log(err);
        } else {
            console.log('Created Asset Policy');
            accesspolicy_model.AssetId = data.AssetId;
            accesspolicy_model.FileName = data.FileName;
            accesspolicy_model.Size = data.Size;
            accesspolicy_model.Part = data.Part;
            accesspolicy_model.AssetFileId = data.AssetFileId;
            accesspolicy_model.AccessPolicyId = accesspolicy_model.Id;
            accesspolicy_model.MimeType = data.MimeType;
            buildLocator(accesspolicy_model);
        }
    });
}

function buildLocator(data) {
    var time = new Date();
    // Account for differences in server time
    time = time.setMinutes(time.getMinutes() - 10);
    time = new Date(time).toISOString();
    
    var locatorData = {
        StartTime: time,
        Type: 1,
        AssetId: data.AssetId,
        AccessPolicyId: data.Id
    };
    
    var _mimeType = data.MimeType;
    var _size = data.Size;
    var _name = data.FileName;
    var _parentAssetId = data.AssetId;
    var _assetFileId = data.AssetFileId;
    var _accessPolicyId = data.AccessPolicyId;
    
    azureMedia.rest.locator.create(locatorData, function(err, model) {
        if(err) {
            console.log(err);
        } else {
            console.log('Created locator');
            var path = model.BaseUri + '/' + data.FileName;
            var container = model.BaseUri.slice(model.BaseUri.lastIndexOf('/') + 1);
            var blobService = azureStorage.createBlobServiceWithSas(model.BaseUri, model.ContentAccessComponent.slice(1));
            
            blobService.createBlockBlobFromStream(container, data.FileName, data.Part, data.Size, function(err, blob) {
                if(err) {
                    console.log(err);
                } else {
                    console.log('Done uploading');
                    var assetFileUpdate = {
//                        Id: _assetFileId, 
                        ContentFileSize: _size,
                        MimeType: _mimeType,
                        Name: _name,
                        ParentAssetId: _parentAssetId
                    };
                    
                    azureMedia.rest.assetfile.update(_assetFileId, assetFileUpdate, function(err, assetfile) {
                        if(err)
                            console.log(err);
                        else
                            console.log('Asset file updated successfully');
                    });
                    
                    azureMedia.rest.locator.delete(model.Id, function(err) {
                        if(err) {
                            console.log(err);
                        } else {
                            console.log('Locator deleted successfully');
                            azureMedia.rest.accesspolicy.delete(_accessPolicyId, function(err) {
                                if(err)
                                    console.log(err);
                                else
                                    console.log('Access Policty deleted successfully');
                            });
                        }
                    });
                }
            });
        }
    });
}

module.exports = router;
