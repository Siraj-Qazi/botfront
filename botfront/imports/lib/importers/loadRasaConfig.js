import yaml from 'js-yaml';
import { update } from './common';

export const addRasaConfig = ({
    f, rawText, setFileList,
}) => {
    const errors = [];
    const rasaConfig = yaml.safeLoad(rawText);
    Object.keys(rasaConfig).forEach((key) => {
        if (!['pipeline', 'policies', 'language'].includes(key)) {
            errors.push(`${key} is not a valid rasa config data`);
        }
    });
    if (errors.length > 0) {
        return update(setFileList, f, { dataType: 'rasaconfig', errors });
    }
    return update(setFileList, f, { dataType: 'rasaconfig', rawText });
};
