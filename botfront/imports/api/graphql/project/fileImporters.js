import yaml from 'js-yaml';
// import { CREATE_AND_OVERWRITE_RESPONSES as createResponses, DELETE_BOT_RESPONSE as deleteReponse } from '../templates/mutations';
// import { GET_BOT_RESPONSES as listResponses } from '../templates/queries';
// import apolloClient from '../../../startup/client/apollo';
import botResponses from '../botResponses/botResponses.model';

import Conversations from '../conversations/conversations.model';
import Activity from '../activity/activity.model';
import { indexBotResponse } from '../botResponses/mongo/botResponses';

const handleImportForms = () => new Promise(resolve => resolve(true));


const handleImportResponse = async (responses, projectId) => {
    const prepareResponses = responses.map((response) => {
        const index = indexBotResponse(response);
        return { ...response, textIndex: index, projectId };
    });
    try {
        await botResponses.insertMany(prepareResponses);
    } catch (e) {
        if (e.code === 11000) {
            const alreadyExist = e?.result?.result?.writeErrors.map(err => `${err.err.op.key} already exist`).join(', ');
            throw new Error(alreadyExist);
        }
        throw new Error('Error while importing responses');
    }
};

// const handleImportStoryGroups = (files, {
//     projectId, fileReader: [, setFileList], setImportingState, wipeCurrent, existingStoryGroups,
// }) => {
//     if (!files.length) return;
//     setImportingState(true);
//     const insert = () => files.forEach(({
//         _id, name, parsedStories, filename, lastModified,
//     }, idx) => {
//         const callback = wrapMeteorCallback((error) => {
//             if (!error) setFileList({ delete: { filename, lastModified } });
//             if (error || idx === files.length - 1) setImportingState(false);
//         });
//         Meteor.call(
//             'storyGroups.insert',
//             { _id, name, projectId },
//             (err) => {
//                 if (!parsedStories.length || err) return callback(err);
//                 return Meteor.call(
//                     'stories.insert',
//                     parsedStories.map(s => ({ ...s, projectId })),
//                     callback,
//                 );
//             },
//         );
//     });
//     if (wipeCurrent) {
//         Promise.all(existingStoryGroups.map(sg => Meteor.callWithPromise('storyGroups.delete', sg))).then(
//             insert, () => setImportingState(false),
//         );
//     } else insert();
// };

const wipeDomain = async (projectId, existingSlots) => {
    try {
        await botResponses.deleteMany({ projectId });
    } catch (e) {
        throw new Error('Could not wipe the old responses');
    }
    // const deletedSlots = await Promise.all(existingSlots.map(slot => Meteor.callWithPromise('slots.delete', slot, projectId)));
    // if (deletedSlots.some(p => !p)) throw new Error();
    return true;
};

const deduplicate = (listOfObjects, key) => {
    const seen = new Set();
    return listOfObjects.filter((obj) => {
        const value = obj[key];
        if (seen.has(value)) {
            return false;
        }
        seen.add(value);
        return true;
    });
};

const handleImportDomain = async (files, {
    projectId, wipeCurrent, existingSlots, existingStoryGroups,
}) => {
    if (!files.length) return [];
    const allResponses = files.reduce((all, { responses }) => ([...all, ...responses]), []);
    const allSlots = files.reduce((all, { slots }) => ([...all, ...slots]), []);
    // const allForms = files.reduce((all, { bfForms }) => ([...all, ...bfForms]),[]);

    const preparedResponses = deduplicate(allResponses, 'key');
    const preparedSlots = deduplicate(allSlots, 'name');
    // const preparedForms = deduplicate(allForms, 'key');
    const errors = [];
    const insert = async () => {
        // const callback = wrapMeteorCallback((error) => {
        //     if (!error) setFileList({ delete: { filename, lastModified } });
        //     if (error || idx === files.length - 1) setImportingState(false);
        // });
      
        try {
            await handleImportResponse(preparedResponses, projectId);
            // await handleImportForms(bfForms, projectId),
        } catch (e) {
            errors.push(`error when importing responses ${e.message}`);
        }
        try {
            await Meteor.callWithPromise('slots.upsert', preparedSlots, projectId);
            // await handleImportForms(bfForms, projectId),
        } catch (e) {
            errors.push(`error when importing slots ${e.message}`);
        }
    };
        
    if (wipeCurrent) {
        await wipeDomain(projectId, existingSlots);
    }
    await insert();
    return errors;
};

// const handleImportDataset = (files, {
//     projectId, fileReader: [, setFileList], setImportingState, wipeCurrent,
// }) => {
//     if (!files.length) return;
//     setImportingState(true);
//     files.forEach((f, idx) => {
//         Meteor.call(
//             'nlu.import',
//             f.rasa_nlu_data,
//             projectId,
//             f.language,
//             wipeCurrent,
//             f.canonical,
//             wrapMeteorCallback((err) => {
//                 if (!err) {
//                     setFileList({
//                         delete: {
//                             filename: f.filename,
//                             lastModified: f.lastModified,
//                         },
//                     });
//                 }
//                 if (err || idx === files.length - 1) setImportingState(false);
//             }),
//         );
//     });
// };


const handleImportEndpoints = async (files, { projectId }) => {
    if (!files.length) return [];
    const toImport = [files[0]]; // there could only be one file os, but the map is there for ee
    const importResult = await Promise.all(toImport.map(async (f) => {
        try {
            await Meteor.callWithPromise('endpoints.save',
                { projectId, endpoints: f.rawText });
            return null;
        } catch (e) {
            return `error when importing ${f.filename}`;
        }
    }));
    return importResult.filter(r => r);
};


const handleImportCredentials = async (files, { projectId }) => {
    if (!files.length) return [];
    const toImport = [files[0]]; // there could only be one file os, but the map is there for ee
    const importResult = await Promise.all(toImport.map(async (f, idx) => {
        try {
            await Meteor.callWithPromise('credentials.save',
                { projectId, credentials: f.rawText });
            return null;
        } catch (e) {
            return `error when importing ${f.filename}`;
        }
    }));
    // return only the results with data in it (if nothing bad happen it shoudl be and array of null)
    return importResult.filter(r => r);
};


const handleImportRasaConfig = async (files, { projectId }) => {
    if (!files.length) return [];
    const importResult = await Promise.all(
        files.map(async (f, idx) => {
            const { pipeline, policies, language } = f;
            // we only use the policies from the first one
            // this is something decided arbitrarily, there is a warning about it in validation so the user aware of this behavior
            if (idx === 0) {
                try {
                    await Meteor.callWithPromise(
                        'policies.save',
                        { policies: yaml.safeDump(policies), projectId },
                    );
                } catch (e) {
                    return `error when importing policies from ${f.filename}`;
                }
            }
            try {
                await Meteor.callWithPromise(
                    'nlu.update.pipeline',
                    projectId, language, yaml.safeDump(pipeline),
                );
                return null;
            } catch (e) {
                return `error when importing pipeline from ${f.filename}`;
            }
        }),
    );
    // return only the results with data in it (if nothing bad happen it shoudl be and array of null)
    return importResult.filter(r => r);
};


const handleImportBotfrontConfig = async (files, { projectId }) => {
    if (!files.length) return [];
    const toImport = files[0]; // we use the first file, as there could be only one project config
    const { project, instance } = toImport;
    try {
        await Meteor.callWithPromise(
            'instance.update',
            { ...instance, projectId },
        );
        await Meteor.callWithPromise(
            'project.update',
            { ...project, _id: projectId, training: {} },
        );
        return [null];
    } catch (e) {
        return [`error when project configuration from ${toImport.filename}`];
    }
};


const handleImportConversations = async (files, {
    projectId, wipeCurrent,
}) => {
    if (!files.length) return [];
    if (wipeCurrent) {
        await Conversations.delete({ projectId });
    }
    const importResult = await Promise.all(files.map(async (f) => {
        try {
            const { conversations } = f;
            const preparedConversations = conversations.map(conv => ({ ...conv, projectId }));
            await Conversations.insertMany(preparedConversations);
            return null;
        } catch (e) {
            if (e.code === 11000) {
                return `error when importing conversations from ${f.filename}, it seems that some of the data you are trying to import already exists`;
            }
            return `error when importing conversations form ${f.filename}`;
        }
    }));
    // return only the results with data in it (if nothing bad happen it shoudl be and array of null)
    return importResult.filter(r => r);
};


const handleImportIncoming = async (files, {
    projectId, wipeCurrent,
}) => {
    if (!files.length) return [];
    if (wipeCurrent) {
        await Activity.delete({ projectId });
    }
    const importResult = await Promise.all(files.map(async (f) => {
        try {
            const { incoming } = f;
            const preparedIncoming = incoming.map(utterance => ({ ...utterance, projectId }));
            await Activity.insertMany(preparedIncoming);
            return null;
        } catch (e) {
            if (e.code === 11000) {
                return `error when importing incoming from ${f.filename}, it seems that some of the data you are trying to import already exists`;
            }
            return `error when importing incoming from ${f.filename}`;
        }
    }));
    // return only the results with data in it (if nothing bad happen it shoudl be and array of null)
    return importResult.filter(r => r);
};


// import all file in the array of files
// the files should have been processed before by the validation step
export const handleImportAll = async (files, params) => {
    const importers = [];
    // handleImportStoryGroups(files.filter(f => f.dataType === 'stories'), params);
    importers.push(handleImportDomain(files.filter(f => f.dataType === 'domain'), params));
    // handleImportDataset(files.filter(f => f.dataType === 'nlu'), params);
    importers.push(handleImportEndpoints(files.filter(f => f.dataType === 'endpoints'), params));
    importers.push(handleImportCredentials(files.filter(f => f.dataType === 'credentials'), params));
    importers.push(handleImportRasaConfig(files.filter(f => f.dataType === 'rasaconfig'), params));
    importers.push(handleImportBotfrontConfig(files.filter(f => f.dataType === 'bfconfig'), params));
    importers.push(handleImportConversations(files.filter(f => f.dataType === 'conversations'), params));
    importers.push(handleImportIncoming(files.filter(f => f.dataType === 'incoming'), params));
    // importers return a arrays of array of errors, we flaten it and remove the null values
    return (await Promise.all(importers)).flat().filter(r => r);
};
